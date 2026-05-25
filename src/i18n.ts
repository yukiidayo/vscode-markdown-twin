import * as vscode from 'vscode';
import { translations, TranslationType } from './locales';

export type Locale = 'en' | 'ja' | 'ko';

const SUPPORTED_LOCALES: Locale[] = ['en', 'ja', 'ko'];

export function getLocale(): Locale {
  const envLang = vscode.env.language.toLowerCase();
  for (const locale of SUPPORTED_LOCALES) {
    if (envLang.startsWith(locale)) {
      return locale;
    }
  }
  return 'en';
}

export function t<K extends keyof TranslationType>(
  key: K,
  ...args: TranslationType[K] extends (...innerArgs: infer A) => string ? A : []
): string {
  const locale = getLocale();
  const dict = translations[locale] ?? translations.en;
  const value = dict[key];
  if (typeof value === 'function') {
    const fn = value as (...fnArgs: unknown[]) => string;
    return fn(...(args as unknown[]));
  }
  return value;
}
