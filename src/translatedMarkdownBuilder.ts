import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { EXCLUDED_TOKEN_TYPES } from './languageDetector';

export type TranslationViewMode = 'translation-only' | 'bilingual';

export interface TranslatedMarkdownResult {
  text: string;
  lineOrigins: number[];
}

type Replacement = {
  start: number;
  end: number;
  text: string;
  sourceStartLine: number;
  sourceEndLine: number;
};

interface BuildTranslatedMarkdownArgs {
  document: vscode.TextDocument;
  langCode: string;
  mode: TranslationViewMode;
  md: MarkdownIt;
  getTranslation: (content: string, langCode: string) => string | null;
}

export function buildTranslatedMarkdown(args: BuildTranslatedMarkdownArgs): TranslatedMarkdownResult {
  const { document, langCode, mode, md, getTranslation } = args;
  const originalText = document.getText();
  const lineOffsets = buildLineOffsets(originalText);

  const replacements = collectInlineReplacements(
    originalText,
    langCode,
    mode,
    md,
    getTranslation,
    lineOffsets
  );
  if (replacements.length === 0) {
    return {
      text: originalText,
      lineOrigins: buildIdentityLineOrigins(originalText),
    };
  }

  return applyReplacements(originalText, replacements, lineOffsets);
}

function collectInlineReplacements(
  source: string,
  langCode: string,
  mode: TranslationViewMode,
  md: MarkdownIt,
  getTranslation: (content: string, langCode: string) => string | null,
  lineOffsets: number[]
): Replacement[] {
  const tokens = md.parse(source, {});
  const rangeCursor = new Map<string, number>();
  const replacements: Replacement[] = [];

  for (const token of tokens) {
    if (EXCLUDED_TOKEN_TYPES.includes(token.type as any)) continue;
    if (token.type !== 'inline') continue;

    const translation = getTranslation(token.content, langCode);
    if (!translation || translation === token.content) continue;
    if (!Array.isArray(token.map) || token.map.length < 2) continue;

    const [startLine, endLineExclusive] = token.map;
    const rangeStart = lineOffsets[startLine] ?? 0;
    const rangeEnd = lineOffsets[endLineExclusive] ?? source.length;
    const rangeKey = `${startLine}:${endLineExclusive}`;
    const searchStart = Math.max(rangeStart, rangeCursor.get(rangeKey) ?? rangeStart);

    const hitIndex = source.indexOf(token.content, searchStart);
    if (hitIndex < 0) continue;
    if (hitIndex + token.content.length > rangeEnd) continue;

    rangeCursor.set(rangeKey, hitIndex + token.content.length);

    const replacementText = mode === 'translation-only'
      ? translation
      : `${token.content}\n\n*${translation}*`;

    replacements.push({
      start: hitIndex,
      end: hitIndex + token.content.length,
      text: replacementText,
      sourceStartLine: offsetToLine(lineOffsets, hitIndex),
      sourceEndLine: offsetToLine(lineOffsets, Math.max(hitIndex, hitIndex + token.content.length - 1)),
    });
  }

  return normalizeReplacements(replacements);
}

function normalizeReplacements(replacements: Replacement[]): Replacement[] {
  const ordered = replacements.sort((a, b) => {
    if (a.start === b.start) return b.end - a.end;
    return a.start - b.start;
  });

  const result: Replacement[] = [];
  let lastEnd = -1;
  for (const replacement of ordered) {
    if (replacement.start < lastEnd) {
      continue;
    }
    result.push(replacement);
    lastEnd = replacement.end;
  }

  return result;
}

function applyReplacements(
  source: string,
  replacements: Replacement[],
  lineOffsets: number[]
): TranslatedMarkdownResult {
  const ordered = [...replacements].sort((a, b) => a.start - b.start);
  const segments: Array<{ text: string; lineOrigins: number[] }> = [];
  let cursor = 0;

  for (const replacement of ordered) {
    if (cursor < replacement.start) {
      const unchangedText = source.slice(cursor, replacement.start);
      segments.push({
        text: unchangedText,
        lineOrigins: buildSegmentLineOrigins(unchangedText, offsetToLine(lineOffsets, cursor)),
      });
    }

    segments.push({
      text: replacement.text,
      lineOrigins: buildReplacementLineOrigins(
        replacement.text,
        replacement.sourceStartLine,
        replacement.sourceEndLine
      ),
    });
    cursor = replacement.end;
  }

  if (cursor < source.length) {
    const tailText = source.slice(cursor);
    segments.push({
      text: tailText,
      lineOrigins: buildSegmentLineOrigins(tailText, offsetToLine(lineOffsets, cursor)),
    });
  }

  return mergeTextSegments(segments);
}

function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  offsets.push(source.length);
  return offsets;
}

function buildIdentityLineOrigins(source: string): number[] {
  const lineCount = source.split(/\r?\n/).length;
  return Array.from({ length: lineCount }, (_, index) => index);
}

function offsetToLine(lineOffsets: number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineOffsets[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, Math.min(low, lineOffsets.length - 2));
}

function buildSegmentLineOrigins(text: string, startLine: number): number[] {
  if (text.length === 0) return [];
  const origins = [startLine];
  let line = startLine;
  const newlineMatches = text.match(/\r?\n/g) ?? [];
  for (const _ of newlineMatches) {
    line += 1;
    origins.push(line);
  }
  return origins;
}

function buildReplacementLineOrigins(text: string, startLine: number, endLine: number): number[] {
  if (text.length === 0) return [];
  const lineCount = text.split(/\r?\n/).length;
  const maxLine = Math.max(startLine, endLine);
  return Array.from({ length: lineCount }, (_, index) => Math.min(startLine + index, maxLine));
}

function endsWithNewline(text: string): boolean {
  return /\r?\n$/.test(text);
}

function mergeTextSegments(segments: Array<{ text: string; lineOrigins: number[] }>): TranslatedMarkdownResult {
  let text = '';
  const lineOrigins: number[] = [];
  let startsNewLine = true;

  for (const segment of segments) {
    text += segment.text;
    if (segment.text.length === 0 || segment.lineOrigins.length === 0) {
      continue;
    }

    if (startsNewLine) {
      lineOrigins.push(...segment.lineOrigins);
    } else {
      if (lineOrigins.length === 0) {
        lineOrigins.push(segment.lineOrigins[0]);
      }
      if (segment.lineOrigins.length > 1) {
        lineOrigins.push(...segment.lineOrigins.slice(1));
      }
    }

    startsNewLine = endsWithNewline(segment.text);
  }

  if (lineOrigins.length === 0) {
    lineOrigins.push(0);
  }

  return { text, lineOrigins };
}
