export type ProviderId = 'google-cloud' | 'microsoft' | 'deepl' | 'papago';

export interface ITranslationProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly requiresApiKey: boolean;

  translate(
    texts: string[],
    sourceLang: string,
    targetLang: string
  ): Promise<string[]>;
}

export const DEFAULT_PROVIDER_ID: ProviderId = 'microsoft';

export const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
  'google-cloud': 'Google Cloud',
  microsoft: 'Azure',
  deepl: 'DeepL',
  papago: 'Papago',
};

const PROVIDER_ALIAS_TO_ID: Record<string, ProviderId> = {
  'google-cloud': 'google-cloud',
  'google cloud': 'google-cloud',
  'google cloud translation': 'google-cloud',
  azure: 'microsoft',
  microsoft: 'microsoft',
  deepl: 'deepl',
  papago: 'papago',
};

export function normalizeProviderId(rawValue: string | undefined): ProviderId {
  if (!rawValue) {
    return DEFAULT_PROVIDER_ID;
  }

  const normalized = rawValue.trim().toLowerCase();
  return PROVIDER_ALIAS_TO_ID[normalized] ?? DEFAULT_PROVIDER_ID;
}
