import * as vscode from 'vscode';
import { TranslationManager } from '../translationManager';
import { EXCLUDED_TOKEN_TYPES } from '../languageDetector';
import { t } from '../i18n';
import { escapeHtml } from '../utils/html';

interface PluginOptions {
  translationManager: TranslationManager;
  document: vscode.TextDocument;
  langCode: string;
}

export function markdownTwinWebviewPlugin(md: any, options: PluginOptions): any {
  const { translationManager, document, langCode } = options;
  const uri = document.uri;

  md.core.ruler.push('markdown-twin-translate-webview', (state: any) => {
    if (!translationManager.isActive()) return;

    const mode = translationManager.getMode();
    const translating = translationManager.isTranslating();
    const insertions: { index: number; token: any }[] = [];

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];

      if (EXCLUDED_TOKEN_TYPES.includes(token.type as any)) continue;
      if (token.type !== 'inline') continue;

      const translation = translationManager.getTranslation(uri, token.content, langCode);

      if (mode === 'translation-only') {
        // ???????????????????????????
        if (translation) {
          token.content = translation;
          if (token.children) {
            token.children = [{ type: 'text', content: translation, level: 0 }];
          }
        } else if (translating) {
          const htmlTokenOpen = new state.Token('html_inline', '', 0);
          htmlTokenOpen.content = '<span class="mt-translation-only mt-pending">';
          const htmlTokenClose = new state.Token('html_inline', '', 0);
          htmlTokenClose.content = '</span>';
          if (token.children) {
            token.children.unshift(htmlTokenOpen);
            token.children.push(htmlTokenClose);
          }
        }
      } else {
        // ??????????????????????????????????????
        if (translation) {
          const htmlToken = new state.Token('html_block', '', 0);
          htmlToken.content = `<div class="mt-translation">${escapeHtml(translation)}</div>\n`;
          insertions.push({ index: i + 1, token: htmlToken });
        } else if (translating) {
          const htmlToken = new state.Token('html_block', '', 0);
          htmlToken.content = `<div class="mt-translation mt-pending">${escapeHtml(t('translatingWaiting'))}</div>\n`;
          insertions.push({ index: i + 1, token: htmlToken });
        }
      }
    }

    for (let j = insertions.length - 1; j >= 0; j--) {
      state.tokens.splice(insertions[j].index, 0, insertions[j].token);
    }
  });

  return md;
}
