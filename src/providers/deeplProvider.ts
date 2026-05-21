import { ITranslationProvider } from './ITranslationProvider';

export class DeeplProvider implements ITranslationProvider {
  readonly id = 'deepl';
  readonly name = 'DeepL';
  readonly requiresApiKey = true;

  constructor(private apiKey: string) {}

  async translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    if (texts.length === 0) return [];

    // キーが ':fx' で終わる場合はFree tierエンドポイント
    const endpoint = this.apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        source_lang: sourceLang === 'auto' ? undefined : sourceLang.toUpperCase(),
        target_lang: targetLang.toUpperCase(),
        tag_handling: 'off',
      }),
    });

    if (!response.ok) {
      const errorJson: any = await response.json().catch(() => ({}));
      const errorMsg = errorJson?.message ?? response.statusText;
      throw new Error(`DeepL translation failed (${response.status}): ${errorMsg}`);
    }

    const data = await response.json() as { translations: { text: string }[] };
    if (!data?.translations) {
      throw new Error('DeepL: Invalid response structure');
    }
    return data.translations.map(t => t.text);
  }
}
