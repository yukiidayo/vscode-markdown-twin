import * as vscode from 'vscode';
import { TranslationManager } from './translationManager';
import { StatusBar } from './statusBar';
import { ApiKeyManager } from './apiKeyManager';
import { ProviderSelector, PROVIDER_DEFS } from './providerSelector';
import { normalizeProviderId, providerRequiresApiKey } from './providers/ITranslationProvider';
import {
  SUPPORTED_LANGUAGES,
  getTargetLanguageCode,
  normalizeSourceLanguageCode,
  normalizeTargetLanguageCode,
} from './languages';
import { PreviewPanel } from './previewPanel';
import { t } from './i18n';
import { isCursor } from './utils';
import { rerunActivePreviewTranslation } from './previewTranslation';
import { runTranslationForDocument } from './translationRunner';

let translationManager: TranslationManager;

function syncTargetLangContext(): void {
  const code = getTargetLanguageCode();
  vscode.commands.executeCommand('setContext', 'markdownTwin.targetLang', code);
}

function resolveTranslationDocument(): vscode.TextDocument | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.languageId === 'markdown') {
    return activeEditor.document;
  }

  const panelDoc = PreviewPanel.getActivePanel()?.editorDocument;
  if (panelDoc?.languageId === 'markdown') {
    return panelDoc;
  }

  return undefined;
}

async function applyTargetLanguageByCode(code: string): Promise<void> {
  const target = SUPPORTED_LANGUAGES.find(l => l.code === code);
  if (!target) return;

  const config = vscode.workspace.getConfiguration('markdownTwin');
  const current = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));
  if (current !== target.code) {
    await config.update('targetLanguage', target.code, vscode.ConfigurationTarget.Global);
  }

  await vscode.commands.executeCommand('setContext', 'markdownTwin.targetLang', target.code);
}

async function migrateLegacySettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('markdownTwin');

  // 旧設定の移行:
  // 表示名や旧形式で保存された値を正規化ID/コードへ統一する
  const rawProvider = config.get<string>('provider');
  const providerId = normalizeProviderId(rawProvider);
  if (rawProvider && rawProvider !== providerId) {
    await config.update('provider', providerId, vscode.ConfigurationTarget.Global);
  }

  const rawSource = config.get<string>('sourceLanguage');
  const sourceCode = normalizeSourceLanguageCode(rawSource);
  if (rawSource && rawSource !== sourceCode) {
    await config.update('sourceLanguage', sourceCode, vscode.ConfigurationTarget.Global);
  }

  const rawTarget = config.get<string>('targetLanguage');
  const targetCode = normalizeTargetLanguageCode(rawTarget);
  if (rawTarget && rawTarget !== targetCode) {
    await config.update('targetLanguage', targetCode, vscode.ConfigurationTarget.Global);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  await migrateLegacySettings();

  const apiKeyManager = new ApiKeyManager(context.secrets);
  translationManager = new TranslationManager(apiKeyManager);
  context.subscriptions.push(translationManager);

  const statusBar = new StatusBar();
  translationManager.setStatusBar(statusBar);
  statusBar.showOffline();

  const providerSelector = new ProviderSelector(apiKeyManager, translationManager, statusBar, context.extensionUri);

  syncTargetLangContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('markdownTwin.targetLanguage')) {
        syncTargetLangContext();
        const activePanel = PreviewPanel.getActivePanel();
        if (activePanel) {
          await PreviewPanel.createOrShow(context.extensionUri, translationManager, activePanel.editorDocument);
        }

        if (translationManager.isActive()) {
          await rerunActivePreviewTranslation(translationManager, { clearCache: true });
        } else {
          statusBar.showOffline();
        }
      }

      if (e.affectsConfiguration('markdownTwin.provider') && !translationManager.isActive()) {
        statusBar.showOffline();
      }
    })
  );

  const toggleHandler = async (requestedLangCode?: string) => {
    if (requestedLangCode) {
      await applyTargetLanguageByCode(requestedLangCode);
    }

    const document = resolveTranslationDocument();
    if (!document) {
      vscode.window.showWarningMessage(t('noActiveEditor'));
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const canCreatePanelFromActiveEditor = !!activeEditor && activeEditor.document.uri.toString() === document.uri.toString();

    const config = vscode.workspace.getConfiguration('markdownTwin');
    const code = getTargetLanguageCode();

    const targetKey = `${document.uri.toString()}@${code}`;
    const panelExists = PreviewPanel.allPanels.has(targetKey);

    if (panelExists) {
      // 既存パネルを再利用しつつ、翻訳状態をアクティブに保つ
      await vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', true);

      if (!isCursor() && canCreatePanelFromActiveEditor) {
        await PreviewPanel.createOrShow(context.extensionUri, translationManager, document);
      }

      await runTranslationForDocument(translationManager, document);
      return;
    }

    if (!canCreatePanelFromActiveEditor) {
      await vscode.window.showTextDocument(document, { preview: false });
    }

    let provider = config.get<string>('provider');
    if (!provider) {
      provider = await providerSelector.show();
      if (!provider) return;
    }

    const providerId = normalizeProviderId(provider);
    if (providerRequiresApiKey(providerId)) {
      const key = await apiKeyManager.getKey(providerId);
      if (!key) {
        await apiKeyManager.prompt(providerId);
      }
    }

    await vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', true);
    const panelReady = await PreviewPanel.createOrShow(context.extensionUri, translationManager, document);
    if (!panelReady) {
      return;
    }

    await runTranslationForDocument(translationManager, document, { overrideProvider: providerId });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.toggleTranslation', toggleHandler)
  );

  for (const lang of SUPPORTED_LANGUAGES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`markdownTwin.toggleTranslation.${lang.code}`, () => toggleHandler(lang.code))
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.toggleBilingual', () => {
      translationManager.toggleMode();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.selectProvider', async () => {
      await providerSelector.showMenu();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.setApiKey', async () => {
      const keyProviders = PROVIDER_DEFS
        .filter(p => p.requiresKey)
        .map(p => ({ label: p.displayName, id: p.id }));
      const picked = await vscode.window.showQuickPick(keyProviders, {
        title: `Markdown Twin: ${t('apiKeySetButton')}`,
        placeHolder: t('selectProviderToReEnter'),
      });
      if (!picked) return;
      const existing = await apiKeyManager.getKey(picked.id);
      await apiKeyManager.prompt(picked.id, existing);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.copyTranslatedMarkdown', async () => {
      const activePanel = PreviewPanel.getActivePanel();
      if (!activePanel) return;
      try {
        const mdText = translationManager.generateTranslatedMarkdown(activePanel.editorDocument, activePanel.langCode);
        await vscode.env.clipboard.writeText(mdText);
        vscode.window.showInformationMessage(t('copiedToClipboard'));
      } catch (err: any) {
        translationManager.logError('Failed to copy translated markdown', err);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.exportTranslatedMarkdown', async () => {
      const activePanel = PreviewPanel.getActivePanel();
      if (!activePanel) return;
      try {
        const mdText = translationManager.generateTranslatedMarkdown(activePanel.editorDocument, activePanel.langCode);

        const docUri = activePanel.editorDocument.uri;
        const uriPath = docUri.path;
        const lastSlash = uriPath.lastIndexOf('/');
        const fileName = lastSlash !== -1 ? uriPath.substring(lastSlash + 1) : 'document.md';
        const lastDot = fileName.lastIndexOf('.');
        const baseName = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;

        const defaultFileName = `${baseName}.${activePanel.langCode}.md`;

        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(docUri, '..', defaultFileName),
          filters: {
            Markdown: ['md', 'markdown']
          }
        });

        if (saveUri) {
          const buffer = Buffer.from(mdText, 'utf8');
          await vscode.workspace.fs.writeFile(saveUri, buffer);
          const saveLastSlash = saveUri.path.lastIndexOf('/');
          const saveFileName = saveLastSlash !== -1 ? saveUri.path.substring(saveLastSlash + 1) : 'translated.md';
          vscode.window.showInformationMessage(t('exportedSuccessfully', saveFileName));
        }
      } catch (err: any) {
        translationManager.logError('Failed to export translated markdown', err);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.openTranslatedSource', () => {
      const activePanel = PreviewPanel.getActivePanel();
      if (activePanel) {
        activePanel.setViewMode('source');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.openPreviewFromSource', () => {
      const activePanel = PreviewPanel.getActivePanel();
      if (activePanel) {
        activePanel.setViewMode('preview');
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async editor => {
      if (!editor || editor.document.languageId !== 'markdown') return;

      const uriStr = editor.document.uri.toString();
      const panelsForDoc = Array.from(PreviewPanel.allPanels.values()).filter(
        p => p.editorDocumentUri.toString() === uriStr
      );

      if (panelsForDoc.length > 0) {
        const code = getTargetLanguageCode();

        const preferredPanel = panelsForDoc.find(p => p.langCode === code) ?? panelsForDoc[0];
        PreviewPanel.currentPanel = preferredPanel;

        if (translationManager.isActive()) {
          await runTranslationForDocument(translationManager, editor.document);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      translationManager.invalidateCache(e.document.uri);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => {
      translationManager.closeDocument(doc.uri);
    })
  );

  context.subscriptions.push(statusBar);

  let firstRunChecked = false;
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async doc => {
      if (firstRunChecked || doc.languageId !== 'markdown') return;
      firstRunChecked = true;

      const allProviderIds = PROVIDER_DEFS.filter(p => p.requiresKey).map(p => p.id);
      const keys = await Promise.all(allProviderIds.map(id => apiKeyManager.getKey(id)));
      const anyKey = keys.some(k => !!k);
      if (!anyKey) {
        const action = await vscode.window.showInformationMessage(
          t('apiKeyNotSet'),
          t('apiKeySetButton')
        );
        if (action) {
          void vscode.commands.executeCommand('markdownTwin.setApiKey');
        }
      }
    })
  );
}

export function deactivate() {
  translationManager?.stopTranslation();
}
