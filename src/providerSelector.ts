import * as vscode from 'vscode';
import { ApiKeyManager } from './apiKeyManager';
import { TranslationManager } from './translationManager';
import { StatusBar } from './statusBar';
import {
  ProviderId,
  PROVIDER_DISPLAY_NAMES,
  normalizeProviderId,
  providerRequiresApiKey,
} from './providers/ITranslationProvider';
import {
  SUPPORTED_LANGUAGES,
  getLanguageLabel,
  normalizeTargetLanguageCode,
} from './languages';
import { PreviewPanel } from './previewPanel';
import { t } from './i18n';
import { retranslateActivePreview } from './previewActions';

interface ProviderItem extends vscode.QuickPickItem {
  id: ProviderId;
  displayName: string;
  requiresKey: boolean;
}

export const PROVIDER_DEFS: Array<{ id: ProviderId; displayName: string; requiresKey: boolean }> = [
  { id: 'google-cloud', displayName: 'Google Cloud', requiresKey: true },
  { id: 'microsoft', displayName: 'Azure', requiresKey: true },
  { id: 'deepl', displayName: 'DeepL', requiresKey: true },
  { id: 'papago', displayName: 'Papago', requiresKey: true },
];

export class ProviderSelector {
  constructor(
    private apiKeyManager: ApiKeyManager,
    private translationManager: TranslationManager,
    private statusBar: StatusBar,
    private extensionUri: vscode.Uri
  ) {}

  async showMenu(): Promise<void> {
    while (true) {
      const config = vscode.workspace.getConfiguration('markdownTwin');
      const providerId = normalizeProviderId(config.get<string>('provider'));
      const targetLang = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));

      const displayProvider = PROVIDER_DISPLAY_NAMES[providerId];
      const langFlagUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'flags', `${targetLang}.svg`);
      const mode = this.translationManager.getMode();
      const modeLabel = mode === 'bilingual' ? t('bilingual') : t('translationOnly');
      const modeIcon = mode === 'bilingual' ? '$(split-horizontal)' : '$(file)';

      type TopItem = vscode.QuickPickItem & { action: 'provider' | 'language' | 'mode' };
      const top = await vscode.window.showQuickPick<TopItem>(
        [
          { label: `$(globe) ${t('provider')}`, description: displayProvider, action: 'provider' },
          { label: t('targetLanguage'), description: getLanguageLabel(targetLang), action: 'language', iconPath: langFlagUri },
          { label: `${modeIcon} ${t('mode')}`, description: modeLabel, action: 'mode' },
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

      this.translationManager.toggleMode();
      return;
    }
  }

  async show(): Promise<ProviderId | undefined> {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const currentId = normalizeProviderId(config.get<string>('provider'));

    const selected = await vscode.window.showQuickPick(
      await this._buildProviderItems(currentId),
      { title: t('selectProvider'), placeHolder: t('chooseProvider'), matchOnDescription: true }
    );
    if (!selected) return undefined;

    await this._applyProvider(selected);
    return selected.id;
  }

  private async _showProviderPicker(): Promise<string | ProviderId | undefined> {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const currentId = normalizeProviderId(config.get<string>('provider'));

    const BACK: vscode.QuickPickItem & { id: string } = { label: `$(arrow-left) ${t('back')}`, id: '__back__' };
    const SEP1: vscode.QuickPickItem & { id: string } = { label: '', kind: vscode.QuickPickItemKind.Separator, id: '__sep1__' };
    const SEP2: vscode.QuickPickItem & { id: string } = { label: '', kind: vscode.QuickPickItemKind.Separator, id: '__sep2__' };
    const RESET: vscode.QuickPickItem & { id: string } = { label: `$(key) ${t('resetApiKey')}`, id: '__reset__' };

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

    await this._applyProvider(selected as ProviderItem);
    return (selected as ProviderItem).id;
  }

  private async _showLanguagePicker(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const currentLang = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));

    type LangItem = vscode.QuickPickItem & { code: string };

    const BACK: LangItem = { label: `$(arrow-left) ${t('back')}`, code: '__back__' };
    const SEP: LangItem = { label: '', kind: vscode.QuickPickItemKind.Separator, code: '__sep__' };

    const langItems: LangItem[] = SUPPORTED_LANGUAGES.map(l => ({
      label: l.label,
      description: currentLang === l.code ? '$(check)' : undefined,
      code: l.code,
      picked: currentLang === l.code,
      iconPath: vscode.Uri.joinPath(this.extensionUri, 'media', 'flags', `${l.code}.svg`),
    }));

    const selected = await vscode.window.showQuickPick<LangItem>(
      [BACK, SEP, ...langItems],
      { title: t('outputLanguage'), placeHolder: t('chooseTargetLanguage') }
    );

    if (!selected) return undefined;
    if (selected.code === '__back__') return '__back__';

    await config.update('targetLanguage', selected.code, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('setContext', 'markdownTwin.targetLang', selected.code);

    const activePanel = PreviewPanel.getActivePanel();
    if (activePanel) {
      await PreviewPanel.createOrShow(this.extensionUri, this.translationManager, activePanel.editorDocument);
    }

    if (this.translationManager.isActive()) {
      await retranslateActivePreview(this.translationManager, { clearCache: true });
    } else {
      this.statusBar.showOffline();
    }

    return selected.code;
  }

  private async _resetApiKey(): Promise<void> {
    const keyProviders = PROVIDER_DEFS.filter(p => p.requiresKey);

    const withKeys = await Promise.all(
      keyProviders.map(async p => {
        const key = await this.apiKeyManager.getKey(p.id);
        return key ? p : null;
      })
    );
    const available = withKeys.filter((p): p is (typeof keyProviders)[0] => p !== null);

    if (available.length === 0) {
      vscode.window.showInformationMessage(t('noSavedKeys'));
      return;
    }

    type ResetItem = vscode.QuickPickItem & { id: ProviderId };
    const picked = await vscode.window.showQuickPick<ResetItem>(
      available.map(p => ({ label: p.displayName, id: p.id })),
      { title: t('resetApiKeyTitle'), placeHolder: t('selectProviderToReEnter') }
    );
    if (!picked) return;

    const existing = await this.apiKeyManager.getKey(picked.id);
    await this.apiKeyManager.prompt(picked.id, existing);
  }

  private async _buildProviderItems(currentId: ProviderId): Promise<ProviderItem[]> {
    return Promise.all(PROVIDER_DEFS.map(async p => {
      const key = await this.apiKeyManager.getKey(p.id);
      let description = key ? 'Key saved' : 'API key required';
      if (currentId === p.id) {
        description += '  $(check)';
      }

      return {
        label: p.displayName,
        description,
        id: p.id,
        displayName: p.displayName,
        requiresKey: p.requiresKey,
        picked: currentId === p.id,
      };
    }));
  }

  private async _applyProvider(selected: ProviderItem): Promise<void> {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    await config.update('provider', selected.id, vscode.ConfigurationTarget.Global);

    if (providerRequiresApiKey(selected.id)) {
      const existing = await this.apiKeyManager.getKey(selected.id);
      if (!existing) {
        await this.apiKeyManager.prompt(selected.id);
      }
    }

    if (this.translationManager.isActive()) {
      await retranslateActivePreview(this.translationManager, {
        clearCache: true,
        overrideProvider: selected.id,
      });
    } else {
      this.statusBar.setActiveProvider(selected.id);
      this.statusBar.showOffline();
    }
  }
}
