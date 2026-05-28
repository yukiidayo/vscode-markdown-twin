import * as vscode from 'vscode';
import { t } from './i18n';

export const DEFAULT_AZURE_REGION = 'global';

export function getAzureRegion(): string {
  const config = vscode.workspace.getConfiguration('markdownTwin');
  return config.get<string>('azureRegion')?.trim() || DEFAULT_AZURE_REGION;
}

export async function promptAzureRegion(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('markdownTwin');
  const currentRegion = getAzureRegion();

  const region = await vscode.window.showInputBox({
    prompt: t('azureRegionPrompt'),
    placeHolder: t('azureRegionPlaceHolder'),
    value: currentRegion,
    ignoreFocusOut: true,
  });

  if (region === undefined) {
    return undefined;
  }

  const trimmed = region.trim();
  if (!trimmed) {
    return currentRegion;
  }

  await config.update('azureRegion', trimmed, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(t('azureRegionSaved', trimmed));
  return trimmed;
}
