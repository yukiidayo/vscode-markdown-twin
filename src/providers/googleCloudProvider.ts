import { ITranslationProvider } from './ITranslationProvider';
import { readResponseErrorMessage, TooManyRequestsError } from './httpError';

export class GoogleCloudProvider implements ITranslationProvider {
  readonly id = 'google-cloud';
  readonly name = 'Google Cloud Translation (Official)';
  readonly requiresApiKey = true;

  constructor(private apiKey: string) {}

  async translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    if (texts.length === 0) return [];

    const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;

    const requestBody: any = {
      q: texts,
      target: targetLang,
      format: 'text',
    };

    if (sourceLang !== 'auto') {
      requestBody.source = sourceLang;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorMsg = await readResponseErrorMessage(response, [
        payload => payload?.error?.message,
      ]);
      if (response.status === 429) {
        throw new TooManyRequestsError(`Google Cloud rate limit: ${errorMsg}`);
      }
      throw new Error(`Google Cloud Translation failed: ${errorMsg}`);
    }

    const data = await response.json() as {
      data: { translations: { translatedText: string; detectedSourceLanguage?: string }[] };
    };

    if (!data?.data?.translations) {
      throw new Error('Invalid response structure from Google Cloud');
    }

    return data.data.translations.map(t => t.translatedText);
  }
}
