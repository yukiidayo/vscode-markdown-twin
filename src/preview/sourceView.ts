import { escapeHtml } from '../utils/html';
import type { TranslatedMarkdownResult } from '../translatedMarkdownBuilder';
import type { MarkdownSourceHighlighter } from './sourceHighlighter';

const SOURCE_LINE_HEIGHT = 19;

export interface SourceView {
  highlightedSource: string;
  sourceText: string;
  sourceLineCount: number;
  sourceLineOrigins: number[];
  sourceLineHeight: number;
  sourceHighlightError?: string;
}

export async function renderSourceView(
  translated: TranslatedMarkdownResult,
  sourceHighlighter: MarkdownSourceHighlighter,
  logHighlightError: (message: string, err: unknown) => void
): Promise<SourceView> {
  const sourceMarkdown = translated.text;
  let highlightedSource = escapeHtml(sourceMarkdown);
  let sourceHighlightError: string | undefined;

  try {
    highlightedSource = await sourceHighlighter.highlight(sourceMarkdown);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    sourceHighlightError = `Source highlight failed: ${reason}`;
    logHighlightError(sourceHighlightError, err);
  }

  return {
    highlightedSource,
    sourceText: sourceMarkdown,
    sourceLineCount: countLines(sourceMarkdown),
    sourceLineOrigins: translated.lineOrigins,
    sourceLineHeight: SOURCE_LINE_HEIGHT,
    sourceHighlightError,
  };
}

export function emptySourceView(translated: TranslatedMarkdownResult): SourceView {
  return {
    highlightedSource: '',
    sourceText: translated.text,
    sourceLineCount: countLines(translated.text),
    sourceLineOrigins: translated.lineOrigins,
    sourceLineHeight: SOURCE_LINE_HEIGHT,
  };
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}
