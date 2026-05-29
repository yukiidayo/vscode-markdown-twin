import * as vscode from 'vscode';
import { ApiKeyManager } from '../apiKeyManager';

describe('ApiKeyManager', () => {
  const createSecrets = () => {
    const values = new Map<string, string>();
    return {
      get: jest.fn((key: string) => Promise.resolve(values.get(key))),
      store: jest.fn((key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      }),
      delete: jest.fn((key: string) => {
        values.delete(key);
        return Promise.resolve();
      }),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.env as any).language = 'en';
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    (vscode.window.showInputBox as jest.Mock).mockReset();
  });

  it('prompts for Azure region after saving an Azure API key', async () => {
    const secrets = createSecrets();
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('azure-key')
      .mockResolvedValueOnce('japaneast');

    const manager = new ApiKeyManager(secrets as any);
    await manager.prompt('microsoft');

    expect(secrets.store).toHaveBeenCalledWith('markdownTwin.apiKey.microsoft', 'azure-key');
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(2);
    expect(vscode.workspace.getConfiguration('markdownTwin').update).toHaveBeenCalledWith(
      'azureRegion',
      'japaneast',
      vscode.ConfigurationTarget.Global
    );
  });

  it('does not save a new Azure API key if Azure region entry is cancelled', async () => {
    const secrets = createSecrets();
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('azure-key')
      .mockResolvedValueOnce(undefined);

    const manager = new ApiKeyManager(secrets as any);
    const result = await manager.prompt('microsoft');

    expect(result).toBeUndefined();
    expect(secrets.store).not.toHaveBeenCalled();
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(2);
  });

  it('does not prompt for Azure region for non-Azure providers', async () => {
    const secrets = createSecrets();
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce('google-key');

    const manager = new ApiKeyManager(secrets as any);
    await manager.prompt('google-cloud');

    expect(secrets.store).toHaveBeenCalledWith('markdownTwin.apiKey.google-cloud', 'google-key');
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
  });
});
