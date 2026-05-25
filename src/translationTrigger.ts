import * as vscode from 'vscode';
import { TranslationManager } from './translationManager';
import type { ProviderId } from './providers/ITranslationProvider';

export interface TranslationTriggerOptions {
  clearCache?: boolean;
  overrideProvider?: ProviderId;
}

export async function triggerTranslationForDocument(
  translationManager: TranslationManager,
  document: vscode.TextDocument | undefined,
  options?: TranslationTriggerOptions
): Promise<boolean> {
  if (!document) return false;

  if (options?.clearCache) {
    translationManager.clearAllCache();
  }

  await translationManager.startTranslation(document, options?.overrideProvider);
  return true;
}
