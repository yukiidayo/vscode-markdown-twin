import * as vscode from 'vscode';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import { TranslationManager } from './translationManager';
import { getTargetLanguageCode } from './languages';
import { EXCLUDED_TOKEN_TYPES } from './languageDetector';

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

  public get editorDocumentUri(): vscode.Uri {
    return this._editor.document.uri;
  }

  public static createOrShow(extensionUri: vscode.Uri, translationManager: TranslationManager) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage('Markdown Twin: No active editor to preview');
      return;
    }

    const code = getTargetLanguageCode();

    const uriStr = activeEditor.document.uri.toString();
    const panelKey = `${uriStr}@${code}`;

    const column = activeEditor.viewColumn;
    const targetColumn = column ? column + 1 : vscode.ViewColumn.Two;

    // 同じ「ドキュメント ＋ 言語」のパネルが既にある → フォーカスしてcurrentに昇格
    const existing = PreviewPanel.allPanels.get(panelKey);
    if (existing) {
      existing._panel.reveal(targetColumn);
      PreviewPanel.currentPanel = existing;
      return;
    }

    // 別ドキュメント or 別言語 → 新規パネル作成（完全にロックされたプレビュー）
    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      `Twin ${path.basename(activeEditor.document.fileName)}`,
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
    translationManager.setTargetLanguages(
      Array.from(PreviewPanel.allPanels.values()).map(p => p.langCode)
    );
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
      this.translationManager.onTranslationUpdated(() => {
        const activeUri = this.translationManager.getActiveUri();
        if (activeUri && activeUri.toString() === this._editor.document.uri.toString()) {
          if (this._isSameDocAsActive) {
            this._update();
          }
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

    if (!this._isInitialized) {
      const twinCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown-twin.css'))
      );
      const markdownCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown.css'))
      );
      webview.html = this._getHtmlForWebview(webview, renderedHtml, markdownCssUri, twinCssUri);
      this._isInitialized = true;
    } else {
      webview.postMessage({ type: 'update', html: renderedHtml });
    }
  }

  public dispose() {
    const uriStr = this._editor.document.uri.toString();
    const panelKey = `${uriStr}@${this.langCode}`;
    PreviewPanel.allPanels.delete(panelKey);
    this.translationManager.setTargetLanguages(
      Array.from(PreviewPanel.allPanels.values()).map(p => p.langCode)
    );

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

  private _getHtmlForWebview(webview: vscode.Webview, renderedHtml: string, markdownCssUri: vscode.Uri, twinCssUri: vscode.Uri) {
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
    <div id="content">${renderedHtml}</div>
    <script>
        const vscode = acquireVsCodeApi();
        let isSyncingScroll = false;
        let scrollTimeout;

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                document.getElementById('content').innerHTML = message.html;
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
            const element = findElementAtViewportTop();
            if (element) {
                const line = parseInt(element.getAttribute('data-line'), 10);
                vscode.postMessage({ command: 'scroll', line: line });
            }
        });

        function findElementByLine(line) {
            const elements = Array.from(document.querySelectorAll('[data-line]'));
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
            const elements = Array.from(document.querySelectorAll('[data-line]'));
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
          htmlToken.content = `<div class="mt-translation mt-pending">翻訳中...</div>\n`;
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
