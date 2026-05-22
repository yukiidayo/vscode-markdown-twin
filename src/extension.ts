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

export async function activate(context: vscode.ExtensionContext) {
  const apiKeyManager = new ApiKeyManager(context.secrets);
  translationManager = new TranslationManager(apiKeyManager);
  context.subscriptions.push(translationManager);

  const statusBar = new StatusBar();
  translationManager.setStatusBar(statusBar);
  statusBar.showOffline();

  const providerSelector = new ProviderSelector(apiKeyManager, translationManager, statusBar, context.extensionUri);

  // 起動時とVSCode設定直接編集時にエディタタイトルのフラグアイコンを同期
  syncTargetLangContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('markdownTwin.targetLanguage')) {
        syncTargetLangContext();
      }
    })
  );

  // Command: Toggle Translation（本体ハンドラ）
  const toggleHandler = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = vscode.workspace.getConfiguration('markdownTwin');
    const code = getTargetLanguageCode();

    // 既に同じドキュメント＆同じ言語のプレビューがアクティブかつ翻訳が有効な場合
    const targetKey = `${editor.document.uri.toString()}@${code}`;
    const panelExists = PreviewPanel.allPanels.has(targetKey);

    if (panelExists) {
      if (isCursor()) {
        // Cursor の場合は reveal すると閉じてしまうバグがあるため、早期リターンする（現状維持）
        return;
      } else {
        // VS Code の場合は reveal してフォーカスさせ、翻訳を同期
        PreviewPanel.createOrShow(context.extensionUri, translationManager);
        if (translationManager.isActive()) {
          translationManager.startTranslation(editor.document);
        }
        return;
      }
    }

    // プロバイダー確認
    let provider = config.get<string>('provider');
    if (!provider) {
      provider = await providerSelector.show();
      if (!provider) return;
    }

    // 設定値は表示名（例: "Azure"）なので内部IDに変換してからキー確認
    const providerId = PROVIDER_ID_BY_NAME[provider] ?? provider;
    const requiresKey = ['deepl', 'papago', 'microsoft', 'google-cloud'].includes(providerId);
    if (requiresKey) {
      const key = await apiKeyManager.getKey(providerId);
      if (!key) {
        await apiKeyManager.prompt(providerId);
      }
    }

    await vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', true);
    // プレビュー表示（既存の同じファイル・言語のタブがあればフォーカス、無ければ新規作成）
    PreviewPanel.createOrShow(context.extensionUri, translationManager);
    // 翻訳開始
    translationManager.startTranslation(editor.document, provider);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTwin.toggleTranslation', toggleHandler)
  );

  // 言語別コマンド（エディタタイトルのフラグアイコン用）- 全て同じハンドラ
  for (const lang of SUPPORTED_LANGUAGES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`markdownTwin.toggleTranslation.${lang.code}`, toggleHandler)
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

  // 初回 Markdown オープン時: APIキーが一件もなければ通知を出す
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
