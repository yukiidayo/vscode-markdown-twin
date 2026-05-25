import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { TranslationManager } from './translationManager';
import type { ProviderId } from './providers/ITranslationProvider';

export function getCurrentPreviewDocument(): vscode.TextDocument | undefined {
  const activeUri = PreviewPanel.currentPanel?.editorDocumentUri;
  if (!activeUri) return undefined;

  return vscode.workspace.textDocuments.find(
    d => d.uri.toString() === activeUri.toString()
  );
}

export async function restartTranslationForCurrentPreview(
  translationManager: TranslationManager,
  options?: {
    clearCache?: boolean;
    overrideProvider?: ProviderId;
  }
): Promise<boolean> {
  const doc = getCurrentPreviewDocument();
  if (!doc) return false;

  if (options?.clearCache) {
    translationManager.clearAllCache();
  }

  await translationManager.startTranslation(doc, options?.overrideProvider);
  return true;
}
