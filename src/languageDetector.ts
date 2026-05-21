// コードブロック系トークン（翻訳対象外）
export const EXCLUDED_TOKEN_TYPES = ['fence', 'code_block', 'html_block'] as const;

// 日本語文字（ひらがな・カタカナ・漢字）を含むか
export function containsJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

// 英数字・記号のみで構成される識別子か（front-web, npm.cmd など）
export function isIdentifierOnly(text: string): boolean {
  return /^[a-zA-Z0-9\-_/.@:#*~]+$/.test(text.trim());
}

// 翻訳対象かどうかの最終判定
export function shouldTranslate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isIdentifierOnly(trimmed)) return false;
  return containsJapanese(trimmed);
}

// テキストを「英語識別子」と「日本語部分」に分割する
// 例: "React Router v7 フロントエンド"
// → [{text: "React Router v7 ", translate: false}, {text: "フロントエンド", translate: true}]
export interface TextPart {
  text: string;
  translate: boolean;
}

export function splitTranslatableParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  // 英数字・記号の連続を識別子として切り出す正規表現
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

// 分割翻訳後に再結合する
// translations: translate=true の部分を翻訳した結果（順番通り）
export function joinTranslatedParts(
  parts: TextPart[],
  translations: Map<number, string>
): string {
  let transIdx = 0;
  return parts.map((part) => {
    if (part.translate) {
      return translations.get(transIdx++) ?? part.text;
    }
    return part.text;
  }).join('');
}
