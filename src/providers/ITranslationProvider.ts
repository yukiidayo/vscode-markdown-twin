export interface ITranslationProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresApiKey: boolean;

  translate(
    texts: string[],     // バッチ（複数テキスト）
    sourceLang: string,  // 'ja', 'auto' など
    targetLang: string   // 'ko', 'en' など
  ): Promise<string[]>;
}

/** 設定・ステータスバー表示用の名前 (ID → 表示名) */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'google-cloud':  'Google Cloud',
  'microsoft':     'Azure',
  'deepl':         'DeepL',
  'papago':        'Papago',
};

/** 設定から読んだ表示名 → 内部プロバイダーID */
export const PROVIDER_ID_BY_NAME: Record<string, string> = {
  'Google Cloud':  'google-cloud',
  'Azure':         'microsoft',
  'DeepL':         'deepl',
  'Papago':        'papago',
};
