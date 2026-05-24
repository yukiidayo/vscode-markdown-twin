import * as vscode from 'vscode';
import { TranslationManager } from './translationManager';
import { StatusBar } from './statusBar';
import { ApiKeyManager } from './apiKeyManager';
import { ProviderSelector, PROVIDER_DEFS } from './providerSelector';
import { PROVIDER_ID_BY_NAME } from './providers/ITranslationProvider';
import { PreviewPanel } from './previewPanel';
import { SUPPORTED_LANGUAGES, getTargetLanguageCode } from './languages';
import { t } from './i18n';
import { isCursor } from './utils';

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
  const current = config.get<string>('targetLanguage');
  if (current !== target.label) {
    await config.update('targetLanguage', target.label, vscode.ConfigurationTarget.Global);
  }
  await vscode.commands.executeCommand('setContext', 'markdownTwin.targetLang', code);
  PreviewPanel.updateFlagIcon(code);
}

export async function activate(context: vscode.ExtensionContext) {
  const apiKeyManager = new ApiKeyManager(context.secrets);
  translationManager = new TranslationManager(apiKeyManager);
  context.subscriptions.push(translationManager);

  const statusBar = new StatusBar();
  translationManager.setStatusBar(statusBar);
  statusBar.showOffline();

  const providerSelector = new ProviderSelector(apiKeyManager, translationManager, statusBar, context.extensionUri);

  // 襍ｷ蜍墓凾縺ｨVSCode險ｭ螳夂峩謗･邱ｨ髮・凾縺ｫ繧ｨ繝・ぅ繧ｿ繧ｿ繧､繝医Ν縺ｮ繝輔Λ繧ｰ繧｢繧､繧ｳ繝ｳ繧貞酔譛・
  syncTargetLangContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('markdownTwin.targetLanguage')) {
        syncTargetLangContext();
        const code = getTargetLanguageCode();
        PreviewPanel.updateFlagIcon(code);

        if (translationManager.isActive()) {
          const activeUri = PreviewPanel.currentPanel?.editorDocumentUri;
          const doc = activeUri && vscode.workspace.textDocuments.find(
            d => d.uri.toString() === activeUri.toString()
          );
          if (doc) {
            translationManager.clearAllCache();
            await translationManager.startTranslation(doc);
          }
        } else {
          statusBar.showOffline();
        }
      }

      if (e.affectsConfiguration('markdownTwin.provider')) {
        if (!translationManager.isActive()) {
          statusBar.showOffline();
        }
      }
    })
  );

  // Command: Toggle Translation・域悽菴薙ワ繝ｳ繝峨Λ・・
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

    // 譌｢縺ｫ蜷後§繝峨く繝･繝｡繝ｳ繝茨ｼ・酔縺倩ｨ隱槭・繝励Ξ繝薙Η繝ｼ縺後い繧ｯ繝・ぅ繝悶°縺､鄙ｻ險ｳ縺梧怏蜉ｹ縺ｪ蝣ｴ蜷・
    const targetKey = `${document.uri.toString()}@${code}`;
    const panelExists = PreviewPanel.allPanels.has(targetKey);

    if (panelExists) {
      await vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', true);

      if (!isCursor() && canCreatePanelFromActiveEditor) {
        // VS Code では既存パネルを前面表示する
        await PreviewPanel.createOrShow(context.extensionUri, translationManager, document);
      }

      await translationManager.startTranslation(document);
      return;
    }

    if (!canCreatePanelFromActiveEditor) {
      await vscode.window.showTextDocument(document, { preview: false });
    }

    // 繝励Ο繝舌う繝繝ｼ遒ｺ隱・
    let provider = config.get<string>('provider');
    if (!provider) {
      provider = await providerSelector.show();
      if (!provider) return;
    }

    // 險ｭ螳壼､縺ｯ陦ｨ遉ｺ蜷搾ｼ井ｾ・ "Azure"・峨↑縺ｮ縺ｧ蜀・ΚID縺ｫ螟画鋤縺励※縺九ｉ繧ｭ繝ｼ遒ｺ隱・
    const providerId = PROVIDER_ID_BY_NAME[provider] ?? provider;
    const requiresKey = ['deepl', 'papago', 'microsoft', 'google-cloud'].includes(providerId);
    if (requiresKey) {
      const key = await apiKeyManager.getKey(providerId);
      if (!key) {
        await apiKeyManager.prompt(providerId);
      }
    }

    await vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', true);
    // 繝励Ξ繝薙Η繝ｼ陦ｨ遉ｺ・域里蟄倥・蜷後§繝輔ぃ繧､繝ｫ繝ｻ險隱槭・繧ｿ繝悶′縺ゅｌ縺ｰ繝輔か繝ｼ繧ｫ繧ｹ縲∫┌縺代ｌ縺ｰ譁ｰ隕丈ｽ懈・・・
    const panelReady = await PreviewPanel.createOrShow(context.extensionUri, translationManager, document);
    if (!panelReady) {
      return;
    }
    // 鄙ｻ險ｳ髢句ｧ・
    translationManager.startTranslation(document, provider);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.toggleTranslation', toggleHandler)
  );

  // 險隱槫挨繧ｳ繝槭Φ繝会ｼ医お繝・ぅ繧ｿ繧ｿ繧､繝医Ν縺ｮ繝輔Λ繧ｰ繧｢繧､繧ｳ繝ｳ逕ｨ・・ 蜈ｨ縺ｦ蜷後§繝上Φ繝峨Λ
  for (const lang of SUPPORTED_LANGUAGES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`markdownTwin.toggleTranslation.${lang.code}`, () => toggleHandler(lang.code))
    );
  }

  // Command: Toggle Bilingual Mode
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.toggleBilingual', () => {
      translationManager.toggleMode();
    })
  );

  // Command: Select Provider / Language (2-level menu)
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.selectProvider', async () => {
      await providerSelector.showMenu();
    })
  );

  // Command: Set API Key
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

  // Command: Copy Translated Markdown
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

  // Command: Export Translated Markdown
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
        
        const ext = '.md';
        const defaultFileName = `${baseName}.${activePanel.langCode}${ext}`;
        
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(docUri, '..', defaultFileName),
          filters: {
            'Markdown': ['md', 'markdown']
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

  // Command: Show Translated Source
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.openTranslatedSource', () => {
      const activePanel = PreviewPanel.getActivePanel();
      if (activePanel) {
        activePanel.setViewMode('source');
      }
    })
  );

  // Command: Show Translated Preview
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.openPreviewFromSource', () => {
      const activePanel = PreviewPanel.getActivePanel();
      if (activePanel) {
        activePanel.setViewMode('preview');
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
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
          translationManager.startTranslation(editor.document);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      translationManager.invalidateCache(e.document.uri);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      translationManager.closeDocument(doc.uri);
    })
  );

  context.subscriptions.push(statusBar);

  // 蛻晏屓 Markdown 繧ｪ繝ｼ繝励Φ譎・ API繧ｭ繝ｼ縺御ｸ莉ｶ繧ゅ↑縺代ｌ縺ｰ騾夂衍繧貞・縺・
  let firstRunChecked = false;
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
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
          vscode.commands.executeCommand('markdownTwin.setApiKey');
        }
      }
    })
  );
}

export function deactivate() {
  translationManager?.stopTranslation();
}

