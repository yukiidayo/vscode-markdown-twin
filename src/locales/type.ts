export interface TranslationType {
  // menus / Quick Pick
  selectSetting: string;
  provider: string;
  targetLanguage: string;
  mode: string;
  bilingual: string;
  translationOnly: string;
  back: string;
  resetApiKey: string;
  selectProvider: string;
  chooseProvider: string;
  chooseTargetLanguage: string;
  outputLanguage: string;
  resetApiKeyTitle: string;
  selectProviderToReEnter: string;
  noSavedKeys: string;

  // API Key Manager
  apiKeyAlreadyConfigured: string;
  apiKeyPaste: string;
  apiKeyEnter: (provider: string) => string;
  apiKeyAlreadyConfiguredPapago: string;
  apiKeyFormatPapago: string;
  apiKeyEnterPapago: string;

  // Notifications / Messages
  apiKeyNotSet: string;
  apiKeySetButton: string;
  noActiveEditor: string;
  previewTitle: (filename: string) => string;
  translatingWaiting: string;
  apiKeyNotSetForProvider: (provider: string) => string;
  azureRegionError: (region: string) => string;
  openSettings: string;
  rateLimitReached: string;
  translationFailed: (provider: string, lang: string) => string;
  showOutputHint: string;

  // Status Bar
  translatingTooltip: (done: number, total: number) => string;
  statusCompleteTooltip: (mode: string, provider: string, target: string) => string;
  statusOfflineTooltip: (provider: string) => string;
  statusErrorText: (provider: string) => string;
  statusErrorTooltip: string;
}
