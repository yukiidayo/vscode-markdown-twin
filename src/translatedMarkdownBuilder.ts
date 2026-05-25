import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { EXCLUDED_TOKEN_TYPES } from './languageDetector';

export type TranslationViewMode = 'translation-only' | 'bilingual';

type Replacement = {
  start: number;
  end: number;
  text: string;
};

interface BuildTranslatedMarkdownArgs {
  document: vscode.TextDocument;
  langCode: string;
  mode: TranslationViewMode;
  md: MarkdownIt;
  getTranslation: (content: string, langCode: string) => string | null;
}

export function buildTranslatedMarkdown(args: BuildTranslatedMarkdownArgs): string {
  const { document, langCode, mode, md, getTranslation } = args;
  const originalText = document.getText();

  const replacements = collectInlineReplacements(document, originalText, langCode, mode, md, getTranslation);
  if (replacements.length === 0) return originalText;

  return applyReplacements(originalText, replacements);
}

function collectInlineReplacements(
  document: vscode.TextDocument,
  source: string,
  langCode: string,
  mode: TranslationViewMode,
  md: MarkdownIt,
  getTranslation: (content: string, langCode: string) => string | null
): Replacement[] {
  // ASTベースでinline token単位に置換し、重複翻訳や誤置換を避ける。
  const lineOffsets = buildLineOffsets(source);
  const tokens = md.parse(source, {});
  const rangeCursor = new Map<string, number>();
  const replacements: Replacement[] = [];

  for (const token of tokens) {
    if (EXCLUDED_TOKEN_TYPES.includes(token.type as any)) continue;
    if (token.type !== 'inline') continue;

    const translation = getTranslation(token.content, langCode);
    if (!translation || translation === token.content) continue;
    if (!Array.isArray(token.map) || token.map.length < 2) continue;

    const [startLine, endLine] = token.map;
    const rangeStart = lineOffsets[startLine] ?? 0;
    const rangeEnd = lineOffsets[endLine] ?? source.length;
    const rangeKey = `${startLine}:${endLine}`;
    // 同一レンジに同じ文字列が複数回出るケースのため、探索開始位置を前進させる。
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
    });
  }

  return normalizeReplacements(replacements);
}

function normalizeReplacements(replacements: Replacement[]): Replacement[] {
  // 位置順に正規化し、重なりがある置換は後続を捨てて安全側に倒す。
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

function applyReplacements(source: string, replacements: Replacement[]): string {
  // 後ろから置換することで、先頭側インデックスずれを防ぐ。
  let output = source;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  return output;
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
