export const EXCLUDED_TOKEN_TYPES = ['fence', 'code_block', 'html_block'] as const;

export function containsJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

export function isIdentifierOnly(text: string): boolean {
  return /^[a-zA-Z0-9\-_/.@:#*~]+$/.test(text.trim());
}

export function shouldTranslate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isIdentifierOnly(trimmed)) return false;
  return containsJapanese(trimmed);
}

export interface TextPart {
  text: string;
  translate: boolean;
}

export function splitTranslatableParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const identifierPattern = /([A-Za-z0-9][A-Za-z0-9\-_./:@#]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = identifierPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      parts.push({ text: before, translate: containsJapanese(before) });
    }

    parts.push({ text: match[0], translate: false });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    parts.push({ text: remaining, translate: containsJapanese(remaining) });
  }

  return parts;
}

export function joinTranslatedParts(parts: TextPart[], translations: Map<number, string>): string {
  let transIdx = 0;
  return parts.map(part => {
    if (part.translate) {
      return translations.get(transIdx++) ?? part.text;
    }
    return part.text;
  }).join('');
}
