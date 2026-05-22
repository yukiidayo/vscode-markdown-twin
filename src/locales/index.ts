import { TranslationType } from './type';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';

export { TranslationType };

export const translations: Record<string, TranslationType> = {
  en,
  ja,
  ko,
};
