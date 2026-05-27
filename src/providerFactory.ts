import { ApiKeyManager } from './apiKeyManager';
import { DeeplProvider } from './providers/deeplProvider';
import { GoogleCloudProvider } from './providers/googleCloudProvider';
import { ITranslationProvider, ProviderId } from './providers/ITranslationProvider';
import { MicrosoftProvider } from './providers/microsoftProvider';
import { PapagoProvider } from './providers/papagoProvider';

export async function buildTranslationProvider(
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
