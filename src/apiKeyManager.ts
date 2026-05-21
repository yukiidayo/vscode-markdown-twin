import * as vscode from 'vscode';

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
    let placeHolder = existingKey ? '•••••••• (Already configured. Enter new key to overwrite)' : 'Paste your API key here';
    let promptMessage = `Enter your ${provider} API key`;

    if (provider === 'papago') {
      placeHolder = existingKey ? '•••••••• (Already configured. Format: ClientID:ClientSecret)' : 'Format: ClientID:ClientSecret';
      promptMessage = 'Enter Papago API key as "ClientID:ClientSecret"';
    }

    const key = await vscode.window.showInputBox({
      prompt: promptMessage,
      placeHolder: placeHolder,
      password: true,        // マスク表示
      ignoreFocusOut: true,  // フォーカスが外れても閉じない
    });

    if (key !== undefined) {
      const trimmed = key.trim();
      if (trimmed) {
        await this.setKey(provider, trimmed);
        return trimmed;
      }
    }
    return existingKey;
  }
}
