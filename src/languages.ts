import * as vscode from 'vscode';

export interface Language {
  label: string;
  code: string;
  displayCode: string;
}

export const DEFAULT_LANG_CODE = 'ko';
export const AUTO_DETECT_LABEL = 'Auto Detect (自動検出)';

export const SUPPORTED_LANGUAGES: Language[] = [
  { label: 'Japanese (日本語)', code: 'ja', displayCode: 'JA' },
  { label: 'English (English)', code: 'en', displayCode: 'EN' },
  { label: 'Korean (한국어)', code: 'ko', displayCode: 'KO' },
  { label: 'Spanish (Español)', code: 'es', displayCode: 'ES' },
  { label: 'French (Français)', code: 'fr', displayCode: 'FR' },
  { label: 'German (Deutsch)', code: 'de', displayCode: 'DE' },
  { label: 'Italian (Italiano)', code: 'it', displayCode: 'IT' },
  { label: 'Portuguese (Português)', code: 'pt', displayCode: 'PT' },
  { label: 'Russian (Русский)', code: 'ru', displayCode: 'RU' },
  { label: 'Vietnamese (Tiếng Việt)', code: 'vi', displayCode: 'VI' },
  { label: 'Thai (ไทย)', code: 'th', displayCode: 'TH' },
  { label: 'Indonesian (Bahasa Indonesia)', code: 'id', displayCode: 'ID' },
  { label: 'Arabic (العربية)', code: 'ar', displayCode: 'AR' },
  { label: 'Hindi (हिन्दी)', code: 'hi', displayCode: 'HI' }
];

export const FLAG_EMOJI: Record<string, string> = {
  ja: '🇯🇵', en: '🇺🇸', ko: '🇰🇷', es: '🇪🇸',
  fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', pt: '🇧🇷',
  ru: '🇷🇺', vi: '🇻🇳', th: '🇹🇭', id: '🇮🇩',
  ar: '🇸🇦', hi: '🇮🇳',
};

export function getLangFlag(langLabel: string): string {
  const lang = SUPPORTED_LANGUAGES.find(l => l.label === langLabel);
  return FLAG_EMOJI[lang?.code ?? ''] ?? '$(globe)';
}

function findLanguage(lang: string): Language | undefined {
  const lower = lang.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.find(l =>
    l.label.toLowerCase() === lower ||
    l.code.toLowerCase() === lower ||
    l.displayCode.toLowerCase() === lower
  );
}

export function getLanguageCode(lang: string): string {
  if (!lang) return DEFAULT_LANG_CODE.toUpperCase();
  return findLanguage(lang)?.displayCode ?? lang.trim().toUpperCase().slice(0, 2);
}

export function getLanguageISO(lang: string): string {
  if (!lang) return DEFAULT_LANG_CODE;
  if (lang.trim() === AUTO_DETECT_LABEL) return 'auto';
  return findLanguage(lang)?.code ?? lang.trim().toLowerCase();
}

export function getLanguageCodeFromLabel(label: string): string {
  return SUPPORTED_LANGUAGES.find(l => l.label === label)?.code ?? DEFAULT_LANG_CODE;
}

export function getTargetLanguageCode(): string {
  const config = vscode.workspace.getConfiguration('markdownTwin');
  const rawTarget = config.get<string>('targetLanguage') ?? 'Korean (한국어)';
  return getLanguageCodeFromLabel(rawTarget);
}

