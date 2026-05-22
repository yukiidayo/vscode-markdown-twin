import * as vscode from 'vscode';
import { getLanguageCode } from './languages';
import { PROVIDER_DISPLAY_NAMES, PROVIDER_ID_BY_NAME } from './providers/ITranslationProvider';
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

  /** 設定値（表示名 or 内部ID）→ 内部ID → 表示名 の順で解決 */
  private resolveProviderName(): string {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    if (this.activeProviderId) {
      return PROVIDER_DISPLAY_NAMES[this.activeProviderId] ?? this.activeProviderId;
    }
    const raw = config.get<string>('provider') ?? 'Azure';
    const id = PROVIDER_ID_BY_NAME[raw] ?? raw;
    return PROVIDER_DISPLAY_NAMES[id] ?? raw;
  }

  showProgress(done: number, total: number): void {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const rawTarget = config.get<string>('targetLanguage') ?? 'Korean (한국어)';
    const targetLang = getLanguageCode(rawTarget);
    const providerName = this.resolveProviderName();
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    this.item.text = `$(sync~spin) Twin ${providerName} ${pct}% (${targetLang})`;
    this.item.tooltip = t('translatingTooltip', done, total);
    this.item.show();
  }

  showComplete(mode: 'translation-only' | 'bilingual'): void {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const rawTarget = config.get<string>('targetLanguage') ?? 'Korean (한국어)';
    const targetLang = getLanguageCode(rawTarget);
    const providerName = this.resolveProviderName();
    const icon = mode === 'bilingual' ? '$(split-horizontal)' : '$(globe)';
    this.item.text = `${icon} Twin ${providerName} (${targetLang})`;
    
    const modeLabel = mode === 'bilingual' ? t('bilingual') : t('translationOnly');
    this.item.tooltip = t('statusCompleteTooltip', modeLabel, providerName, targetLang);
    this.item.show();
  }

  /** 翻訳非アクティブ時: プロバイダー名を常時表示して操作の入口を確保 */
  showOffline(): void {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const rawTarget = config.get<string>('targetLanguage') ?? 'Korean (한국어)';
    const targetLang = getLanguageCode(rawTarget);
    const providerName = this.resolveProviderName();
    this.item.text = `$(globe) Twin: ${providerName} (${targetLang})`;
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
