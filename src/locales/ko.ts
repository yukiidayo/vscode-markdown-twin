import { TranslationType } from './type';

export const ko: TranslationType = {
  // menus / Quick Pick
  selectSetting: '변경할 설정 선택',
  provider: '번역 프로바이더',
  targetLanguage: '출력 언어',
  mode: '표시 모드',
  bilingual: '이중 언어 표시',
  translationOnly: '번역만 표시',
  back: '이전',
  resetApiKey: 'API 키 재설정...',
  selectProvider: '번역 프로바이더 선택',
  chooseProvider: '프로바이더를 선택하세요',
  chooseTargetLanguage: '출력 언어를 선택하세요',
  outputLanguage: '출력 언어',
  resetApiKeyTitle: 'API 키 재설정',
  selectProviderToReEnter: 'API 키를 다시 입력할 프로바이더를 선택하세요',
  noSavedKeys: '현재 저장된 API 키가 없습니다.',

  // API Key Manager
  apiKeyAlreadyConfigured: '•••••••• (이미 설정됨. 덮어쓰려면 새 키를 입력하세요)',
  apiKeyPaste: '여기에 API 키를 붙여넣으세요',
  apiKeyEnter: (provider: string) => `${provider} API 키를 입력하세요`,
  apiKeyAlreadyConfiguredPapago: '•••••••• (이미 설정됨. 형식: ClientID:ClientSecret)',
  apiKeyFormatPapago: '형식: ClientID:ClientSecret',
  apiKeyEnterPapago: 'Papago API 키를 "ClientID:ClientSecret" 형식으로 입력하세요',

  // Notifications / Messages
  apiKeyNotSet: 'Markdown Twin: API 키가 설정되어 있지 않습니다. 번역을 시작하려면 API 키를 설정해 주세요.',
  apiKeySetButton: 'API 키 설정하기',
  noActiveEditor: 'Markdown Twin: 프리뷰할 활성 에디터가 없습니다',
  previewTitle: (filename: string) => `Twin ${filename}`,
  translatingWaiting: '번역 중...',
  apiKeyNotSetForProvider: (provider: string) => `프로바이더 "${provider}"의 API 키가 설정되어 있지 않습니다. "Markdown Twin: Set API Key" 명령을 사용하여 API 키를 설정해 주세요.`,
  azureRegionError: (region: string) => `Markdown Twin: Azure 리전 설정이 올바르지 않을 수 있습니다 (현재: "${region}"). "markdownTwin.azureRegion" 설정을 확인해 주세요 (예: global, japaneast, eastus).`,
  openSettings: '설정 열기',
  rateLimitReached: '번역 프로바이더의 속도 제한에 도달했습니다. 잠시 후 자동으로 재시도됩니다.',
  translationFailed: (provider: string, lang: string) => `번역 프로바이더 "${provider}"번역에 실패했습니다 (언어: ${lang})`,
  showOutputHint: ' (자세한 내용은 출력 채널 "Markdown Twin"을 확인해 주세요)',
  copiedToClipboard: '번역된 Markdown을 클립보드에 복사했습니다!',
  exportedSuccessfully: (filename: string) => `${filename}에 성공적으로 내보냈습니다`,

  // Status Bar
  translatingTooltip: (done: number, total: number) => `번역 중… ${done}/${total} | 클릭하여 프로바이더 변경`,
  statusCompleteTooltip: (mode: string, provider: string, target: string) => `Markdown Twin: ${mode} · ${provider} · ${target} | 클릭하여 프로바이더 변경`,
  statusOfflineTooltip: (provider: string) => `Markdown Twin: 준비 완료 · ${provider} | 클릭하여 프로바이더 변경`,
  statusErrorText: (provider: string) => `Twin: 오류 (${provider})`,
  statusErrorTooltip: '번역 오류 · 자세한 내용은 출력 패널 확인 | 클릭하여 프로바이더 변경',
};
