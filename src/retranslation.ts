import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { TranslationManager } from './translationManager';
import { triggerTranslationForDocument, type TranslationTriggerOptions } from './translationTrigger';

export function getCurrentPreviewDocument(): vscode.TextDocument | undefined {
  const activeUri = PreviewPanel.currentPanel?.editorDocumentUri;
  if (!activeUri) return undefined;

  return vscode.workspace.textDocuments.find(
    d => d.uri.toString() === activeUri.toString()
  );
}

export async function restartTranslationForCurrentPreview(
  translationManager: TranslationManager,
  options?: TranslationTriggerOptions
): Promise<boolean> {
  const doc = getCurrentPreviewDocument();
  if (!doc) return false;
  await triggerTranslationForDocument(translationManager, doc, options);
  return true;
}
