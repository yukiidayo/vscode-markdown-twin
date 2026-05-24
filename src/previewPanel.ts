import * as vscode from 'vscode';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
import { TranslationManager } from './translationManager';
import { getTargetLanguageCode } from './languages';
import { EXCLUDED_TOKEN_TYPES } from './languageDetector';
import { t } from './i18n';
import { isCursor } from './utils';

export class PreviewPanel {
  public static currentPanel: PreviewPanel | undefined;
  public static readonly allPanels = new Map<string, PreviewPanel>();
  public static readonly viewType = 'markdownTwinPreview';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _editor: vscode.TextEditor;
  private _isInitialized = false;
  public readonly langCode: string;
  private _viewMode: 'preview' | 'source' = 'preview';

  public get editorDocumentUri(): vscode.Uri {
    return this._editor.document.uri;
  }

  public get editorDocument(): vscode.TextDocument {
    return this._editor.document;
  }

  public get viewColumn(): vscode.ViewColumn | undefined {
    return this._panel.viewColumn;
  }

  public setViewMode(mode: 'preview' | 'source'): void {
    this._viewMode = mode;
    this._panel.webview.postMessage({ type: 'setViewMode', mode });
    vscode.commands.executeCommand('setContext', 'markdownTwin.showingSource', mode === 'source');
  }

  public static createOrShow(extensionUri: vscode.Uri, translationManager: TranslationManager) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage(t('noActiveEditor'));
      return;
    }

    const code = getTargetLanguageCode();

    const uriStr = activeEditor.document.uri.toString();
    const panelKey = `${uriStr}@${code}`;

    const column = activeEditor.viewColumn;
    const targetColumn = column ? column + 1 : vscode.ViewColumn.Two;

    // 同じ「ドキュメント ＋ 言語」のパネルが既にある → そのまま維持
    // reveal() は Cursor でトグル（閉じる）動作になるため呼ばない。VS Code ではフォーカスする。
    const existing = PreviewPanel.allPanels.get(panelKey);
    if (existing) {
      PreviewPanel.currentPanel = existing;
      if (!isCursor()) {
        existing._panel.reveal(targetColumn);
      }
      return;
    }

    // 別ドキュメント or 別言語 → 新規パネル作成（完全にロックされたプレビュー）
    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      t('previewTitle', path.basename(activeEditor.document.fileName)),
      targetColumn,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))
        ],
        retainContextWhenHidden: true
      }
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'flags', `${code}.svg`);

    const newPanel = new PreviewPanel(panel, extensionUri, activeEditor, translationManager, code);
    PreviewPanel.currentPanel = newPanel;
    PreviewPanel.allPanels.set(panelKey, newPanel);
  }

  public static updateFlagIcon(langCode: string): void {
    if (!PreviewPanel.currentPanel) return;
    const uri = PreviewPanel.currentPanel._extensionUri;
    PreviewPanel.currentPanel._panel.iconPath = vscode.Uri.joinPath(uri, 'media', 'flags', `${langCode}.svg`);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    editor: vscode.TextEditor,
    private translationManager: TranslationManager,
    langCode: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._editor = editor;
    this.langCode = langCode;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // 自身がアクティブ（フォーカス）されたとき、表示を更新して翻訳状態と同期
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.active) {
          PreviewPanel.currentPanel = this;
          if (this.translationManager.isActive()) {
            this.translationManager.startTranslation(this._editor.document);
          } else {
            this._update();
          }
        }
      },
      null,
      this._disposables
    );

    this._panel.webview.onDidReceiveMessage(
      message => {
        if (message.command === 'scroll') {
          this._handleScrollMessage(message.line);
        }
      },
      null,
      this._disposables
    );

    // ★重要★ onDidChangeActiveTextEditor による勝手なエディタ追従処理は、
    // 「完全にドキュメントにロックされたプレビュー」にするため削除しました。

    // 自パネルのドキュメントが編集されたときのみ、表示を更新
    vscode.workspace.onDidChangeTextDocument(
      e => {
        if (e.document.uri.toString() === this._editor.document.uri.toString()) {
          if (this._isSameDocAsActive) {
            this._update();
          }
        }
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeTextEditorVisibleRanges(
      e => {
        if (e.textEditor === this._editor && e.visibleRanges.length > 0) {
          const topLine = e.visibleRanges[0].start.line;
          this._panel.webview.postMessage({ type: 'scroll', line: topLine });
        }
      },
      null,
      this._disposables
    );

    // 自身に関連する翻訳更新を受け取ったら再描画
    this._disposables.push(
      this.translationManager.onTranslationUpdated((updatedUri) => {
        const docUriStr = this._editor.document.uri.toString();
        if (!updatedUri || updatedUri.toString() === docUriStr) {
          this._update();
        }
      })
    );
  }

  private get _isSameDocAsActive(): boolean {
    return !!(
      PreviewPanel.currentPanel &&
      PreviewPanel.currentPanel.editorDocumentUri.toString() === this._editor.document.uri.toString()
    );
  }

  private _handleScrollMessage(line: number) {
    const range = new vscode.Range(line, 0, line, 0);
    this._editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  }

  private _update() {
    const webview = this._panel.webview;
    const document = this._editor.document;
    const text = document.getText();

    const md = new MarkdownIt({ html: true });

    md.use((mdInstance) => {
      const originalRender = mdInstance.renderer.render;
      mdInstance.renderer.render = function (tokens: any[], options: any, env: any) {
        for (const token of tokens) {
          if (token.map && token.nesting === 1) {
            const line = token.map[0];
            token.attrSet('data-line', line.toString());
          }
        }
        return originalRender.apply(this, [tokens, options, env]);
      };
    });

    // langCode をプラグインオプションに渡す
    md.use(markdownTwinWebviewPlugin, { translationManager: this.translationManager, document, langCode: this.langCode });

    const renderedHtml = md.render(text);

    // 翻訳適用済みの生のMarkdownソースコードを生成
    const sourceMarkdown = this.translationManager.generateTranslatedMarkdown(document, this.langCode);
    
    // Prism.js を用いて Markdown 構文を美しい HTML にハイライト
    const highlightedSource = Prism.highlight(sourceMarkdown, Prism.languages.markdown, 'markdown');

    if (!this._isInitialized) {
      const twinCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown-twin.css'))
      );
      const markdownCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown.css'))
      );
      webview.html = this._getHtmlForWebview(webview, renderedHtml, highlightedSource, markdownCssUri, twinCssUri);
      this._isInitialized = true;
    } else {
      webview.postMessage({
        type: 'update',
        html: renderedHtml,
        sourceHtml: highlightedSource
      });
    }
  }

  public dispose() {
    vscode.commands.executeCommand('setContext', 'markdownTwin.showingSource', false);
    const uriStr = this._editor.document.uri.toString();
    const panelKey = `${uriStr}@${this.langCode}`;
    PreviewPanel.allPanels.delete(panelKey);

    if (PreviewPanel.currentPanel === this) {
      const remaining = Array.from(PreviewPanel.allPanels.values());
      PreviewPanel.currentPanel = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
    }

    if (PreviewPanel.allPanels.size === 0) {
      this.translationManager.stopTranslation();
      vscode.commands.executeCommand('setContext', 'markdownTwin.translationActive', false);
    }

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    renderedHtml: string,
    highlightedSource: string,
    markdownCssUri: vscode.Uri,
    twinCssUri: vscode.Uri
  ) {
    const isPreview = this._viewMode === 'preview';
    const isSource = this._viewMode === 'source';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Twin Preview</title>
    <link rel="stylesheet" href="${markdownCssUri}">
    <link rel="stylesheet" href="${twinCssUri}">
</head>
<body>
    <!-- プレビュー表示用コンテナ -->
    <div id="preview-container" style="display: ${isPreview ? 'block' : 'none'};">${renderedHtml}</div>

    <!-- ソースコード表示用コンテナ -->
    <div id="source-container" style="display: ${isSource ? 'block' : 'none'};">
        <pre class="language-markdown"><code class="language-markdown">${highlightedSource}</code></pre>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isSyncingScroll = false;
        let scrollTimeout;

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                document.getElementById('preview-container').innerHTML = message.html;
                const codeEl = document.getElementById('source-container').querySelector('code');
                if (codeEl) {
                    codeEl.innerHTML = message.sourceHtml;
                }
            } else if (message.type === 'setViewMode') {
                const previewEl = document.getElementById('preview-container');
                const sourceEl = document.getElementById('source-container');
                if (message.mode === 'source') {
                    previewEl.style.display = 'none';
                    sourceEl.style.display = 'block';
                } else {
                    previewEl.style.display = 'block';
                    sourceEl.style.display = 'none';
                }
            } else if (message.type === 'scroll') {
                const line = message.line;
                const element = findElementByLine(line);
                if (element) {
                    isSyncingScroll = true;
                    element.scrollIntoView({ behavior: 'auto', block: 'start' });
                    clearTimeout(scrollTimeout);
                    scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
                }
            }
        });

        window.addEventListener('scroll', () => {
            if (isSyncingScroll) return;
            const previewEl = document.getElementById('preview-container');
            if (previewEl && previewEl.style.display !== 'none') {
                const element = findElementAtViewportTop();
                if (element) {
                    const line = parseInt(element.getAttribute('data-line'), 10);
                    vscode.postMessage({ command: 'scroll', line: line });
                }
            }
        });

        function findElementByLine(line) {
            const elements = Array.from(document.querySelectorAll('#preview-container [data-line]'));
            if (elements.length === 0) return null;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                const elLine = parseInt(el.getAttribute('data-line'), 10);
                if (elLine === line) return el;
                const diff = line - elLine;
                if (diff >= 0 && diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest || elements[0];
        }

        function findElementAtViewportTop() {
            const elements = Array.from(document.querySelectorAll('#preview-container [data-line]'));
            if (elements.length === 0) return null;
            const viewportTop = window.scrollY || document.documentElement.scrollTop;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                const diff = Math.abs(el.offsetTop - viewportTop);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest;
        }
    </script>
</body>
</html>`;
  }
}

interface PluginOptions {
  translationManager: TranslationManager;
  document: vscode.TextDocument;
  langCode: string;
}

function markdownTwinWebviewPlugin(md: any, options: PluginOptions): any {
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
        if (translation) {
          token.content = translation;
          if (token.children) {
            token.children = [{ type: 'text', content: translation, level: 0 }];
          }
        } else if (translating) {
          const htmlTokenOpen = new state.Token('html_inline', '', 0);
          htmlTokenOpen.content = `<span class="mt-translation-only mt-pending">`;
          const htmlTokenClose = new state.Token('html_inline', '', 0);
          htmlTokenClose.content = `</span>`;
          if (token.children) {
            token.children.unshift(htmlTokenOpen);
            token.children.push(htmlTokenClose);
          }
        }
      } else {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
