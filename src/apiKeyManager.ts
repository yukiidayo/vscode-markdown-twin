import * as vscode from 'vscode';
import { t } from './i18n';
import { promptAzureRegion } from './azureRegion';

export class ApiKeyManager {
  constructor(private secrets: vscode.SecretStorage) {}

  async getKey(provider: string): Promise<string | undefined> {
    return this.secrets.get(`markdownTwin.apiKey.${provider}`);
  }

  async setKey(provider: string, key: string): Promise<void> {
    await this.secrets.store(`markdownTwin.apiKey.${provider}`, key);
  }

  async deleteKey(provider: string): Promise<void> {
    await this.secrets.delete(`markdownTwin.apiKey.${provider}`);
  }

  async prompt(provider: string, existingKey?: string): Promise<string | undefined> {
    let placeHolder = existingKey ? t('apiKeyAlreadyConfigured') : t('apiKeyPaste');
    let promptMessage = t('apiKeyEnter', provider);

    if (provider === 'papago') {
      placeHolder = existingKey ? t('apiKeyAlreadyConfiguredPapago') : t('apiKeyFormatPapago');
      promptMessage = t('apiKeyEnterPapago');
    }

    const key = await vscode.window.showInputBox({
      prompt: promptMessage,
      placeHolder,
      password: true,
      ignoreFocusOut: true,
    });

    if (key !== undefined) {
      const trimmed = key.trim();
      if (trimmed) {
        if (provider === 'microsoft') {
          const region = await promptAzureRegion();
          if (region === undefined) {
            return existingKey;
          }
        }
        await this.setKey(provider, trimmed);
        return trimmed;
      }
    }

    return existingKey;
  }
}
