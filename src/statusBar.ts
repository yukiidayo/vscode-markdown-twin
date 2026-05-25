import * as vscode from 'vscode';
import { getLanguageCode, normalizeTargetLanguageCode } from './languages';
import { PROVIDER_DISPLAY_NAMES, normalizeProviderId } from './providers/ITranslationProvider';
import { t } from './i18n';

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private activeProviderId: string | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'markdownTwin.selectProvider';
  }

  setActiveProvider(providerId: string | null): void {
    this.activeProviderId = providerId;
  }

  private resolveProviderName(): string {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    if (this.activeProviderId) {
      const id = normalizeProviderId(this.activeProviderId);
      return PROVIDER_DISPLAY_NAMES[id];
    }

    const id = normalizeProviderId(config.get<string>('provider'));
    return PROVIDER_DISPLAY_NAMES[id];
  }

  showProgress(done: number, total: number): void {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const targetLang = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));
    const targetCode = getLanguageCode(targetLang);
    const providerName = this.resolveProviderName();
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    this.item.text = `$(sync~spin) Twin ${providerName} ${pct}% (${targetCode})`;
    this.item.tooltip = t('translatingTooltip', done, total);
    this.item.show();
  }

  showComplete(mode: 'translation-only' | 'bilingual'): void {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const targetLang = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));
    const targetCode = getLanguageCode(targetLang);
    const providerName = this.resolveProviderName();
    const icon = mode === 'bilingual' ? '$(split-horizontal)' : '$(globe)';
    this.item.text = `${icon} Twin ${providerName} (${targetCode})`;

    const modeLabel = mode === 'bilingual' ? t('bilingual') : t('translationOnly');
    this.item.tooltip = t('statusCompleteTooltip', modeLabel, providerName, targetCode);
    this.item.show();
  }

  showOffline(): void {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const targetLang = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));
    const targetCode = getLanguageCode(targetLang);
    const providerName = this.resolveProviderName();
    this.item.text = `$(globe) Twin: ${providerName} (${targetCode})`;
    this.item.tooltip = t('statusOfflineTooltip', providerName);
    this.item.show();
  }

  update(mode: 'translation-only' | 'bilingual'): void {
    this.showComplete(mode);
  }

  showError(): void {
    const providerName = this.resolveProviderName();
    this.item.text = t('statusErrorText', providerName);
    this.item.tooltip = t('statusErrorTooltip');
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
