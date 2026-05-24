import { TranslationType } from './type';

export const ja: TranslationType = {
  // menus / Quick Pick
  selectSetting: '変更する設定を選択してください',
  provider: '翻訳プロバイダー',
  targetLanguage: '出力言語',
  mode: '表示モード',
  bilingual: 'バイリンガル表示',
  translationOnly: '翻訳のみ表示',
  back: '戻る',
  resetApiKey: 'APIキーのリセット...',
  selectProvider: '翻訳プロバイダーの選択',
  chooseProvider: 'プロバイダーを選択してください',
  chooseTargetLanguage: '出力言語を選択してください',
  outputLanguage: '出力言語',
  resetApiKeyTitle: 'APIキーのリセット',
  selectProviderToReEnter: 'APIキーを再入力するプロバイダーを選択してください',
  noSavedKeys: '現在保存されているAPIキーはありません。',

  // API Key Manager
  apiKeyAlreadyConfigured: '•••••••• (設定済み。上書きするには新しいキーを入力してください)',
  apiKeyPaste: 'ここにAPIキーを貼り付けてください',
  apiKeyEnter: (provider: string) => `${provider} のAPIキーを入力してください`,
  apiKeyAlreadyConfiguredPapago: '•••••••• (設定済み。フォーマット: ClientID:ClientSecret)',
  apiKeyFormatPapago: 'フォーマット: ClientID:ClientSecret',
  apiKeyEnterPapago: 'PapagoのAPIキーを "ClientID:ClientSecret" の形式で入力してください',

  // Notifications / Messages
  apiKeyNotSet: 'Markdown Twin: APIキーが設定されていません。翻訳を開始するにはAPIキーを設定してください。',
  apiKeySetButton: 'APIキーを設定する',
  noActiveEditor: 'Markdown Twin: プレビューするアクティブなエディタがありません',
  previewTitle: (filename: string) => `Twin ${filename}`,
  translatingWaiting: '翻訳中...',
  apiKeyNotSetForProvider: (provider: string) => `プロバイダー「${provider}」のAPIキーが設定されていません。コマンド「Markdown Twin: Set API Key」からAPIキーを設定してください。`,
  azureRegionError: (region: string) => `Markdown Twin: Azureのリージョン設定が正しくない可能性があります（現在: "${region}"）。設定「markdownTwin.azureRegion」を確認してください（例: global, japaneast, eastus）。`,
  openSettings: '設定を開く',
  rateLimitReached: '翻訳プロバイダーのレート制限に達しました。しばらく待って自動的に再試行されます。',
  translationFailed: (provider: string, lang: string) => `翻訳プロバイダー「${provider}」での翻訳に失敗しました（言語: ${lang}）`,
  showOutputHint: ' (詳細は出力チャンネル「Markdown Twin」をご確認ください)',
  copiedToClipboard: '翻訳されたMarkdownをクリップボードにコピーしました！',
  exportedSuccessfully: (filename: string) => `${filename} に正常にエクスポートしました`,

  // Status Bar
  translatingTooltip: (done: number, total: number) => `翻訳中… ${done}/${total} | クリックしてプロバイダーを変更`,
  statusCompleteTooltip: (mode: string, provider: string, target: string) => `Markdown Twin: ${mode} · ${provider} · ${target} | クリックしてプロバイダーを変更`,
  statusOfflineTooltip: (provider: string) => `Markdown Twin: 準備完了 · ${provider} | クリックしてプロバイダーを変更`,
  statusErrorText: (provider: string) => `Twin: エラー (${provider})`,
  statusErrorTooltip: '翻訳エラー · 詳細を出力パネルで確認 | クリックしてプロバイダーを変更',
};
