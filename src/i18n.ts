import * as vscode from 'vscode';
import { translations, TranslationType } from './locales';

export type Locale = 'en' | 'ja' | 'ko' | 'zh-Hans' | 'zh-Hant';

const SIMPLE_LOCALES: Locale[] = ['en', 'ja', 'ko'];

export function getLocale(): Locale {
  const envLang = vscode.env.language.toLowerCase();

  if (
    envLang.startsWith('zh-hant') ||
    envLang.startsWith('zh-tw') ||
    envLang.startsWith('zh-hk') ||
    envLang.startsWith('zh-mo')
  ) {
    return 'zh-Hant';
  }

  if (
    envLang.startsWith('zh-hans') ||
    envLang.startsWith('zh-cn') ||
    envLang.startsWith('zh-sg') ||
    envLang === 'zh'
  ) {
    return 'zh-Hans';
  }

  for (const locale of SIMPLE_LOCALES) {
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
  const value = dict[key] ?? translations.en[key];
  if (typeof value === 'function') {
    const fn = value as (...fnArgs: unknown[]) => string;
    return fn(...(args as unknown[]));
  }
  return value;
}
