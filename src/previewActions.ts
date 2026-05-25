import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { TranslationManager } from './translationManager';
import { runTranslationForDocument, type RunTranslationOptions } from './translationRunner';

export interface RetranslatePreviewOptions extends RunTranslationOptions {
  revealPreview?: boolean;
}

interface RetranslatePreviewArgs {
  extensionUri?: vscode.Uri;
  translationManager: TranslationManager;
  document: vscode.TextDocument | undefined;
  options?: RetranslatePreviewOptions;
}

export function getActivePreviewPanel(): PreviewPanel | undefined {
  return PreviewPanel.getActivePanel();
}

export function getActivePreviewDocument(): vscode.TextDocument | undefined {
  const activeUri = getActivePreviewPanel()?.editorDocumentUri;
  if (!activeUri) return undefined;

  return vscode.workspace.textDocuments.find(
    document => document.uri.toString() === activeUri.toString()
  );
}

export async function retranslatePreviewDocument(args: RetranslatePreviewArgs): Promise<boolean> {
  const { extensionUri, translationManager, document, options } = args;
  if (!document) return false;

  await vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', true);

  if (options?.revealPreview) {
    if (!extensionUri) return false;

    const panelReady = await PreviewPanel.createOrShow(extensionUri, translationManager, document);
    if (!panelReady) {
      return false;
    }
  }

  return runTranslationForDocument(translationManager, document, options);
}

export async function retranslateActivePreview(
  translationManager: TranslationManager,
  options?: RetranslatePreviewOptions
): Promise<boolean> {
  return retranslatePreviewDocument({
    translationManager,
    document: getActivePreviewDocument(),
    options,
  });
}
