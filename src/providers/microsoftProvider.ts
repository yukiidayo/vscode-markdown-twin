import { ITranslationProvider } from './ITranslationProvider';
import * as vscode from 'vscode';

export class MicrosoftProvider implements ITranslationProvider {
  readonly id = 'microsoft';
  readonly name = 'Azure Translator';
  readonly requiresApiKey = true;

  constructor(private apiKey: string) {}

  async translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    if (texts.length === 0) return [];

    const params = new URLSearchParams({
      'api-version': '3.0',
      to: targetLang,
    });
    if (sourceLang !== 'auto') {
      params.set('from', sourceLang);
    }

    const config = vscode.workspace.getConfiguration('markdownTwin');
    const region = config.get<string>('azureRegion') ?? 'global';

    const response = await fetch(
      `https://api.cognitive.microsofttranslator.com/translate?${params}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Ocp-Apim-Subscription-Region': region,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(texts.map(text => ({ Text: text }))),
      }
    );

    if (!response.ok) {
      const errorJson: any = await response.json().catch(() => ({}));
      const errorMsg = errorJson?.error?.message ?? response.statusText;
      throw new Error(`Azure translation failed (${response.status}): ${errorMsg}`);
    }

    const data = await response.json() as { translations: { text: string; to: string }[] }[];
    return data.map(item => {
      const text = item.translations[0]?.text;
      if (text === undefined) throw new Error('Azure: Invalid response structure');
      return text;
    });
  }
}
