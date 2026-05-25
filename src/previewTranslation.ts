import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { TranslationManager } from './translationManager';
import { runTranslationForDocument, type RunTranslationOptions } from './translationRunner';

export function getActivePreviewDocument(): vscode.TextDocument | undefined {
  const activeUri = PreviewPanel.currentPanel?.editorDocumentUri;
  if (!activeUri) return undefined;

  return vscode.workspace.textDocuments.find(
    d => d.uri.toString() === activeUri.toString()
  );
}

export async function rerunActivePreviewTranslation(
  translationManager: TranslationManager,
  options?: RunTranslationOptions
): Promise<boolean> {
  const document = getActivePreviewDocument();
  if (!document) return false;
  await runTranslationForDocument(translationManager, document, options);
  return true;
}
