import * as vscode from 'vscode';
import { TranslationManager } from './translationManager';
import type { ProviderId } from './providers/ITranslationProvider';

export interface RunTranslationOptions {
  clearCache?: boolean;
  overrideProvider?: ProviderId;
}

export async function runTranslationForDocument(
  translationManager: TranslationManager,
  document: vscode.TextDocument | undefined,
  options?: RunTranslationOptions
): Promise<boolean> {
  if (!document) return false;

  if (options?.clearCache) {
    translationManager.clearAllCache();
  }

  await translationManager.startTranslation(document, options?.overrideProvider);
  return true;
}
