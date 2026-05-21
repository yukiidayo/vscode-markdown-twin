import { shouldTranslate, splitTranslatableParts, joinTranslatedParts } from '../languageDetector';

describe('Language Detector Tests', () => {
  describe('shouldTranslate', () => {
    it('should translate Japanese sentences', () => {
      expect(shouldTranslate('これは日本語の文章です。')).toBe(true);
      expect(shouldTranslate('こんにちは、世界！')).toBe(true);
    });

    it('should ignore pure English or identifiers', () => {
      expect(shouldTranslate('Hello World')).toBe(false);
      expect(shouldTranslate('12345')).toBe(false);
      expect(shouldTranslate('const x = 1;')).toBe(false);
      expect(shouldTranslate('mt-translation')).toBe(false);
    });

    it('should return false for empty or whitespace strings', () => {
      expect(shouldTranslate('')).toBe(false);
      expect(shouldTranslate('   ')).toBe(false);
    });
  });

  describe('splitTranslatableParts and joinTranslatedParts', () => {
    it('should split Japanese and keep identifiers/inline code intact', () => {
      const text = 'こんにちは `world` です。';
      const parts = splitTranslatableParts(text);
      
      expect(parts.length).toBe(3);
      expect(parts[0]).toEqual({ text: 'こんにちは `', translate: true });
      expect(parts[1]).toEqual({ text: 'world', translate: false });
      expect(parts[2]).toEqual({ text: '` です。', translate: true });
      
      // 再結合テスト
      const translatedMap = new Map<number, string>();
      translatedMap.set(0, 'Hello `'); // translate=true Part 1 (index 0)
      translatedMap.set(1, '` is.');  // translate=true Part 2 (index 1)
      
      const joined = joinTranslatedParts(parts, translatedMap);
      expect(joined).toBe('Hello `world` is.');
    });
  });
});
