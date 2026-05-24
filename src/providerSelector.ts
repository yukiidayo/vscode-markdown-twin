import * as vscode from 'vscode';
import { ApiKeyManager } from './apiKeyManager';
import { TranslationManager } from './translationManager';
import { StatusBar } from './statusBar';
import { PROVIDER_ID_BY_NAME, PROVIDER_DISPLAY_NAMES } from './providers/ITranslationProvider';
import { SUPPORTED_LANGUAGES, getLanguageCodeFromLabel } from './languages';
import { PreviewPanel } from './previewPanel';
import { t } from './i18n';

interface ProviderItem extends vscode.QuickPickItem {
  id: string;
  displayName: string;
  requiresKey: boolean;
}

export const PROVIDER_DEFS: { id: string; displayName: string; requiresKey: boolean }[] = [
  { id: 'google-cloud',  displayName: 'Google Cloud',  requiresKey: true  },
  { id: 'microsoft',     displayName: 'Azure',         requiresKey: true  },
  { id: 'deepl',         displayName: 'DeepL',         requiresKey: true  },
  { id: 'papago',        displayName: 'Papago',        requiresKey: true  },
];

export class ProviderSelector {
  constructor(
    private apiKeyManager: ApiKeyManager,
    private translationManager: TranslationManager,
    private statusBar: StatusBar,
    private extensionUri: vscode.Uri
  ) {}

  // ─────────────────────────────────────────────
  // ステータスバークリック → 2段階メニュー
  // ─────────────────────────────────────────────
  async showMenu(): Promise<void> {
    while (true) {
      const config = vscode.workspace.getConfiguration('markdownTwin');
      const rawProvider = config.get<string>('provider') ?? 'Azure';
      const displayProvider = PROVIDER_DISPLAY_NAMES[rawProvider] ?? rawProvider;
      const rawLang = config.get<string>('targetLanguage') ?? 'Korean (한국어)';

      const langCode = getLanguageCodeFromLabel(rawLang);
      const langFlagUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'flags', `${langCode}.svg`);

      const mode = this.translationManager.getMode();
      const modeLabel = mode === 'bilingual' ? t('bilingual') : t('translationOnly');
      const modeIcon = mode === 'bilingual' ? '$(split-horizontal)' : '$(file)';

      type TopItem = vscode.QuickPickItem & { action: 'provider' | 'language' | 'mode' };
      const top = await vscode.window.showQuickPick<TopItem>(
        [
          { label: `$(globe) ${t('provider')}`, description: displayProvider,          action: 'provider' },
          { label: `${t('targetLanguage')}`,          description: rawLang,                  action: 'language', iconPath: langFlagUri },
          { label: `${modeIcon} ${t('mode')}`,  description: modeLabel,               action: 'mode' },
        ],
        { title: 'Markdown Twin', placeHolder: t('selectSetting') }
      );

      if (!top) return;

      if (top.action === 'provider') {
        const result = await this._showProviderPicker();
        if (result === '__back__') continue;
        return;
      }

      if (top.action === 'language') {
        const result = await this._showLanguagePicker();
        if (result === '__back__') continue;
        return;
      }

      if (top.action === 'mode') {
        this.translationManager.toggleMode();
        return;
      }
    }
  }

  // ─────────────────────────────────────────────
  // 初回セットアップ用（プロバイダー選択のみ）
  // ─────────────────────────────────────────────
  async show(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const rawCurrent = config.get<string>('provider') ?? 'Azure';
    const currentId  = PROVIDER_ID_BY_NAME[rawCurrent] ?? rawCurrent;

    const selected = await vscode.window.showQuickPick(
      await this._buildProviderItems(currentId),
      { title: t('selectProvider'), placeHolder: t('chooseProvider'), matchOnDescription: true }
    );
    if (!selected) return undefined;

    await this._applyProvider(selected);
    return selected.id;
  }

  // ─────────────────────────────────────────────
  // プロバイダーサブメニュー（Back + Reset付き）
  // ─────────────────────────────────────────────
  private async _showProviderPicker(): Promise<string | undefined> {
    const config     = vscode.workspace.getConfiguration('markdownTwin');
    const rawCurrent = config.get<string>('provider') ?? 'Azure';
    const currentId  = PROVIDER_ID_BY_NAME[rawCurrent] ?? rawCurrent;

    const BACK:  ProviderItem = { label: `$(arrow-left) ${t('back')}`,    id: '__back__',  displayName: '', requiresKey: false };
    const SEP1:  ProviderItem = { label: '', kind: vscode.QuickPickItemKind.Separator, id: '', displayName: '', requiresKey: false };
    const SEP2:  ProviderItem = { label: '', kind: vscode.QuickPickItemKind.Separator, id: '', displayName: '', requiresKey: false };
    const RESET: ProviderItem = { label: `$(key) ${t('resetApiKey')}`, id: '__reset__', displayName: '', requiresKey: false };

    const providerItems = await this._buildProviderItems(currentId);

    const selected = await vscode.window.showQuickPick(
      [BACK, SEP1, ...providerItems, SEP2, RESET],
      { title: t('provider'), placeHolder: t('chooseProvider'), matchOnDescription: true }
    );

    if (!selected) return undefined;
    if (selected.id === '__back__') return '__back__';

    if (selected.id === '__reset__') {
      await this._resetApiKey();
      return '__back__';
    }

    await this._applyProvider(selected);
    return selected.id;
  }

  // ─────────────────────────────────────────────
  // 言語サブメニュー（Back付き）
  // ─────────────────────────────────────────────
  private async _showLanguagePicker(): Promise<string | undefined> {
    const config      = vscode.workspace.getConfiguration('markdownTwin');
    const currentLang = config.get<string>('targetLanguage') ?? 'Korean (한국어)';

    type LangItem = vscode.QuickPickItem & { lang: string };

    const BACK: LangItem = { label: `$(arrow-left) ${t('back')}`, lang: '__back__' };
    const SEP:  LangItem = { label: '', kind: vscode.QuickPickItemKind.Separator, lang: '' };

    const langItems: LangItem[] = SUPPORTED_LANGUAGES
      .map(l => ({
        label:       l.label,
        description: currentLang === l.label ? '$(check)' : undefined,
        lang:        l.label,
        picked:      currentLang === l.label,
        iconPath:    vscode.Uri.joinPath(this.extensionUri, 'media', 'flags', `${l.code}.svg`),
      }));

    const selected = await vscode.window.showQuickPick<LangItem>(
      [BACK, SEP, ...langItems],
      { title: t('outputLanguage'), placeHolder: t('chooseTargetLanguage') }
    );

    if (!selected) return undefined;
    if (selected.lang === '__back__') return '__back__';

    await config.update('targetLanguage', selected.lang, vscode.ConfigurationTarget.Global);
    const code = getLanguageCodeFromLabel(selected.lang);
    await vscode.commands.executeCommand('setContext', 'markdownTwin.targetLang', code);
    PreviewPanel.updateFlagIcon(code);

    if (this.translationManager.isActive()) {
      const activeUri = PreviewPanel.currentPanel?.editorDocumentUri;
      const doc = activeUri && vscode.workspace.textDocuments.find(
        d => d.uri.toString() === activeUri.toString()
      );
      if (doc) {
        this.translationManager.clearAllCache();
        await this.translationManager.startTranslation(doc);
      }
    } else {
      this.statusBar.showOffline();
    }

    return selected.lang;
  }

  // ─────────────────────────────────────────────
  // APIキーリセット
  // ─────────────────────────────────────────────
  private async _resetApiKey(): Promise<void> {
    const keyProviders = PROVIDER_DEFS.filter(p => p.requiresKey);

    const withKeys = await Promise.all(
      keyProviders.map(async p => {
        const key = await this.apiKeyManager.getKey(p.id);
        return key ? p : null;
      })
    );
    const available = withKeys.filter((p): p is typeof keyProviders[0] => p !== null);

    if (available.length === 0) {
      vscode.window.showInformationMessage(t('noSavedKeys'));
      return;
    }

    type ResetItem = vscode.QuickPickItem & { id: string };
    const picked = await vscode.window.showQuickPick<ResetItem>(
      available.map(p => ({ label: p.displayName, id: p.id })),
      { title: t('resetApiKeyTitle'), placeHolder: t('selectProviderToReEnter') }
    );
    if (!picked) return;

    const existing = await this.apiKeyManager.getKey(picked.id);
    await this.apiKeyManager.prompt(picked.id, existing);
  }

  // ─────────────────────────────────────────────
  // 共通ヘルパー
  // ─────────────────────────────────────────────
  private async _buildProviderItems(currentId: string): Promise<ProviderItem[]> {
    return Promise.all(PROVIDER_DEFS.map(async p => {
      let desc: string;
      if (!p.requiresKey) {
        desc = 'No API key';
      } else {
        const key = await this.apiKeyManager.getKey(p.id);
        desc = key ? 'Key saved' : 'API key required';
      }
      if (currentId === p.id) { desc += '  $(check)'; }

      return {
        label:       p.displayName,
        description: desc,
        id:          p.id,
        displayName: p.displayName,
        requiresKey: p.requiresKey,
        picked:      currentId === p.id,
      };
    }));
  }

  private async _applyProvider(selected: ProviderItem): Promise<void> {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    await config.update('provider', selected.displayName, vscode.ConfigurationTarget.Global);

    // キー未保存のときだけ入力を促す
    if (selected.requiresKey) {
      const existing = await this.apiKeyManager.getKey(selected.id);
      if (!existing) {
        await this.apiKeyManager.prompt(selected.id);
      }
    }

    if (this.translationManager.isActive()) {
      const activeUri = PreviewPanel.currentPanel?.editorDocumentUri;
      const doc = activeUri && vscode.workspace.textDocuments.find(
        d => d.uri.toString() === activeUri.toString()
      );
      if (doc) {
        this.translationManager.clearAllCache();
        this.translationManager.startTranslation(doc, selected.id);
      }
    } else {
      this.statusBar.setActiveProvider(selected.id);
      this.statusBar.showOffline();
    }
  }
}
