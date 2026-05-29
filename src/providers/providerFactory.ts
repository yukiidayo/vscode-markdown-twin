import { ApiKeyManager } from '../apiKeyManager';
import { DeeplProvider } from './deeplProvider';
import { GoogleCloudProvider } from './googleCloudProvider';
import type { ITranslationProvider, ProviderId } from './ITranslationProvider';
import { MicrosoftProvider } from './microsoftProvider';
import { PapagoProvider } from './papagoProvider';

export async function createTranslationProvider(
  id: ProviderId,
  apiKeyManager: ApiKeyManager
): Promise<ITranslationProvider | null> {
  const getKey = async (providerId: ProviderId) => {
    const key = await apiKeyManager.getKey(providerId);
    return key ?? '';
  };

  switch (id) {
    case 'deepl':
      return new DeeplProvider(await getKey('deepl'));
    case 'papago':
      return new PapagoProvider(await getKey('papago'));
    case 'microsoft':
      return new MicrosoftProvider(await getKey('microsoft'));
    case 'google-cloud':
      return new GoogleCloudProvider(await getKey('google-cloud'));
    default:
      return null;
  }
}
