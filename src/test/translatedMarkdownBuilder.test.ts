import MarkdownIt from 'markdown-it';
import { buildTranslatedMarkdown } from '../translatedMarkdownBuilder';
import { createMarkdownPreviewEngine } from '../preview/markdownEngine';

function createDocument(text: string): any {
  return {
    getText: () => text,
  };
}

describe('buildTranslatedMarkdown', () => {
  it('keeps markdown table structure when translating cell contents', () => {
    const source = [
      '| 項目 | 内容 |',
      '|---|---|',
      '| コンセプト | 未定 |',
    ].join('\n');

    const translated = buildTranslatedMarkdown({
      document: createDocument(source),
      langCode: 'ko',
      mode: 'translation-only',
      md: new MarkdownIt(),
      getTranslation: (content) => {
        const translations = new Map([
          ['項目', '항목'],
          ['内容', '내용'],
          ['コンセプト', '콘셉트'],
          ['未定', '미정'],
        ]);
        return translations.get(content) ?? null;
      },
    });

    const html = createMarkdownPreviewEngine().render(translated.text);

    expect(translated.text).toContain('| 항목 | 내용 |');
    expect(translated.text).toContain('| 콘셉트 | 미정 |');
    expect(html).toContain('<table');
    expect(html).toContain('<td');
  });

  it('sanitizes translated table cells that contain line breaks or pipes', () => {
    const source = [
      '| Key | Value |',
      '|---|---|',
      '| concept | pending |',
    ].join('\n');

    const translated = buildTranslatedMarkdown({
      document: createDocument(source),
      langCode: 'ko',
      mode: 'translation-only',
      md: new MarkdownIt(),
      getTranslation: content => content === 'pending' ? 'line one\nline | two' : null,
    });

    const html = createMarkdownPreviewEngine().render(translated.text);

    expect(translated.text).toContain('| concept | line one line \\| two |');
    expect(html).toContain('<table');
    expect(html).toContain('<td>line one line | two</td>');
  });
});
