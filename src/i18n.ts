import * as vscode from 'vscode';
import { translations, TranslationType } from './locales';

export type Locale = 'en' | 'ja' | 'ko';

const SUPPORTED_LOCALES: Locale[] = [
  'en', 'ja', 'ko'
];

export function getLocale(): Locale {
  const envLang = vscode.env.language.toLowerCase();
  
  // 3言語の接頭辞マッチングを判定 (例: ja-jp -> ja)
  for (const locale of SUPPORTED_LOCALES) {
    if (envLang.startsWith(locale)) {
      return locale;
    }
  }
  return 'en'; // デフォルトは英語
}

export function t<K extends keyof TranslationType>(
  key: K,
  ...args: TranslationType[K] extends (...args: any[]) => any ? Parameters<TranslationType[K]> : []
): string {
  const locale = getLocale();
  const dict = translations[locale] ?? translations['en'];
  const val = dict[key];
  if (typeof val === 'function') {
    return (val as any)(...args);
  }
  return val as string;
}
