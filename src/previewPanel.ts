import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
  private _cachedThemeId: string | null = null;
  private _cachedTokenThemeVars: Record<string, string> = {};

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
    const sourceLineCount = sourceMarkdown.split(/\r?\n/).length;
    const sourceTokenThemeVars = this._resolveSourceTokenThemeVars();

    if (!this._isInitialized) {
      const twinCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown-twin.css'))
      );
      const markdownCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown.css'))
      );
      webview.html = this._getHtmlForWebview(webview, renderedHtml, highlightedSource, sourceLineCount, sourceTokenThemeVars, markdownCssUri, twinCssUri);
      this._isInitialized = true;
    } else {
      webview.postMessage({
        type: 'update',
        html: renderedHtml,
        sourceHtml: highlightedSource,
        sourceLineCount,
        sourceTokenThemeVars
      });
    }
  }

  private _resolveSourceTokenThemeVars(): Record<string, string> {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
    if (this._cachedThemeId === themeId) {
      return this._cachedTokenThemeVars;
    }

    const vars = this._loadSourceTokenThemeVars(themeId);
    this._cachedThemeId = themeId;
    this._cachedTokenThemeVars = vars;
    return vars;
  }

  private _loadSourceTokenThemeVars(themeId: string): Record<string, string> {
    if (!themeId) return {};
    const themePath = this._resolveThemeFilePath(themeId);
    if (!themePath) return {};

    const themeRules = this._readThemeTokenRules(themePath);
    const customRules = this._readCustomizedTokenRules();
    const tokenRules = [...themeRules, ...customRules];
    if (tokenRules.length === 0) return {};

    const pick = (...patterns: string[]) => this._pickTokenForeground(tokenRules, patterns);

    const heading = pick('text.html.markdown markup.heading', 'markup.heading.markdown', 'markup.heading');
    const headingMarker = pick('punctuation.definition.heading.markdown', 'text.html.markdown punctuation.definition.heading.markdown');
    const link = pick('meta.link.inet', 'markup.underline.link', 'string.other.link', 'string.url');
    const linkMarker = pick(
      'text.html.markdown meta.link.inet punctuation',
      'text.html.markdown meta.link.inline punctuation.definition.string',
      'text.html.markdown meta.link.reference punctuation.definition.constant',
      'punctuation.definition.link'
    );
    const linkRef = pick('text.html.markdown meta.link.reference constant.other.reference', 'meta.link.reference constant.other.reference');
    const code = pick('text.html.markdown markup.inline.raw', 'text.html.markdown markup.raw.block', 'markup.inline.raw', 'markup.fenced_code.block');
    const punctuation = pick('punctuation.definition.markdown', 'punctuation.definition.heading.markdown', 'punctuation.definition.table.markdown');
    const boldMarker = pick('text.html.markdown punctuation.definition.bold', 'punctuation.definition.bold');
    const boldContent = pick('markup.bold.markdown', 'markup.bold');
    const italicMarker = pick('text.html.markdown punctuation.definition.italic', 'punctuation.definition.italic');
    const italicContent = pick('markup.italic.markdown', 'markup.italic');
    const strikeMarker = pick('text.html.markdown punctuation.definition.strikethrough', 'punctuation.definition.strikethrough');
    const strikeContent = pick('markup.strikethrough.markdown', 'markup.strikethrough', 'markup.deleted');
    const list = pick('punctuation.definition.list.begin.markdown', 'beginning.punctuation.definition.list');
    const quote = pick('text.html.markdown markup.quote', 'beginning.punctuation.definition.quote');
    const quoteMarker = pick('text.html.markdown beginning.punctuation.definition.quote', 'beginning.punctuation.definition.quote');
    const comment = pick('comment');

    const vars: Record<string, string> = {};
    if (heading) {
      vars['--mt-token-heading'] = heading;
    }
    if (headingMarker) vars['--mt-token-heading-marker'] = headingMarker;
    if (link) {
      vars['--mt-token-link'] = link;
      vars['--mt-token-link-content'] = link;
    }
    if (linkMarker) vars['--mt-token-link-marker'] = linkMarker;
    if (linkRef) vars['--mt-token-link-ref'] = linkRef;
    if (code) vars['--mt-token-code'] = code;
    if (punctuation) {
      vars['--mt-token-punctuation'] = punctuation;
      vars['--mt-token-hr'] = punctuation;
    }
    if (boldMarker) vars['--mt-token-bold-marker'] = boldMarker;
    if (boldContent) vars['--mt-token-bold-content'] = boldContent;
    if (italicMarker) vars['--mt-token-italic-marker'] = italicMarker;
    if (italicContent) vars['--mt-token-italic-content'] = italicContent;
    if (strikeMarker) vars['--mt-token-strike-marker'] = strikeMarker;
    if (strikeContent) vars['--mt-token-strike-content'] = strikeContent;
    if (list) vars['--mt-token-list'] = list;
    if (quote) {
      vars['--mt-token-quote'] = quote;
      vars['--mt-token-comment'] = quote;
    }
    if (quoteMarker) vars['--mt-token-quote-marker'] = quoteMarker;
    if (comment) vars['--mt-token-comment'] = comment;

    return vars;
  }

  private _resolveThemeFilePath(themeId: string): string | null {
    for (const ext of vscode.extensions.all) {
      const themes = ext.packageJSON?.contributes?.themes;
      if (!Array.isArray(themes)) continue;
      const hit = themes.find((theme: any) => theme?.id === themeId || theme?.label === themeId);
      if (hit?.path) {
        return path.join(ext.extensionUri.fsPath, hit.path);
      }
    }
    return null;
  }

  private _readThemeTokenRules(themePath: string, visited = new Set<string>()): Array<{ scope?: string | string[]; settings?: any }> {
    const normalizedPath = path.normalize(themePath);
    if (visited.has(normalizedPath)) return [];
    visited.add(normalizedPath);

    let themeObj: any;
    try {
      const raw = fs.readFileSync(normalizedPath, 'utf8');
      themeObj = Function('"use strict"; return (' + raw + ');')();
    } catch {
      return [];
    }

    let inherited: Array<{ scope?: string | string[]; settings?: any }> = [];
    if (typeof themeObj?.include === 'string') {
      const includePath = path.resolve(path.dirname(normalizedPath), themeObj.include);
      inherited = this._readThemeTokenRules(includePath, visited);
    }

    const own = Array.isArray(themeObj?.tokenColors) ? themeObj.tokenColors : [];
    return [...inherited, ...own];
  }

  private _readCustomizedTokenRules(): Array<{ scope?: string | string[]; settings?: any }> {
    const custom = vscode.workspace.getConfiguration('editor').get<any>('tokenColorCustomizations');
    const rules = custom?.textMateRules;
    return Array.isArray(rules) ? rules : [];
  }

  private _pickTokenForeground(
    tokenRules: Array<{ scope?: string | string[]; settings?: any }>,
    patterns: string[]
  ): string | undefined {
    let picked: string | undefined;
    for (const rule of tokenRules) {
      const scopes = this._normalizeScopes(rule.scope);
      if (scopes.length === 0) continue;
      const isMatch = scopes.some(scope =>
        patterns.some(pattern => scope.includes(pattern))
      );
      if (!isMatch) continue;

      const fg = typeof rule.settings?.foreground === 'string' ? rule.settings.foreground.trim() : '';
      if (fg.length > 0) {
        picked = fg;
      }
    }
    return picked;
  }

  private _normalizeScopes(scope: string | string[] | undefined): string[] {
    if (!scope) return [];
    if (Array.isArray(scope)) {
      return scope.map(s => String(s).trim()).filter(Boolean);
    }
    return String(scope).split(',').map(s => s.trim()).filter(Boolean);
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
    sourceLineCount: number,
    sourceTokenThemeVars: Record<string, string>,
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
    <div id="source-container" style="display: ${isSource ? 'flex' : 'none'};">
        <div id="line-numbers"></div>
        <pre class="language-markdown"><code class="language-markdown" id="source-code">${highlightedSource}</code></pre>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isSyncingScroll = false;
        let scrollTimeout;
        const initialSourceLineCount = ${sourceLineCount};
        const initialSourceTokenThemeVars = ${JSON.stringify(sourceTokenThemeVars)};

        // HTMLタグを壊さずに改行で安全に分割するパーサ関数
        function splitHtmlIntoLines(html) {
            try {
                const lines = [];
                let currentLine = '';
                const tagStack = [];
                const regex = /(<[^>]+>|[^<]+)/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    const token = match[0];
                    if (token.startsWith('<')) {
                        if (token.startsWith('<' + '/')) {
                            tagStack.pop();
                            currentLine += token;
                        } else {
                            if (!token.endsWith('/>') && !token.startsWith('<!--')) {
                                const tagNameMatch = token.match(/<([a-zA-Z0-9]+)/);
                                if (tagNameMatch) {
                                    tagStack.push(token);
                                }
                            }
                            currentLine += token;
                        }
                    } else {
                        const newline = String.fromCharCode(10);
                        const textLines = token.split(newline);
                        for (let i = 0; i < textLines.length; i++) {
                            if (i > 0) {
                                let closeTags = '';
                                for (let j = tagStack.length - 1; j >= 0; j--) {
                                    const openTag = tagStack[j];
                                    const tagMatch = openTag.match(/<([a-zA-Z0-9]+)/);
                                    const tagName = tagMatch ? tagMatch[1] : '';
                                    if (tagName) {
                                        closeTags += '<' + '/' + tagName + '>';
                                    }
                                }
                                currentLine += closeTags;
                                lines.push(currentLine);
                                
                                let openTags = '';
                                for (let j = 0; j < tagStack.length; j++) {
                                    openTags += tagStack[j];
                                }
                                currentLine = openTags;
                            }
                            currentLine += textLines[i];
                        }
                    }
                }
                if (currentLine) {
                    lines.push(currentLine);
                }
                return lines;
            } catch (err) {
                console.error('Error splitting HTML into lines:', err);
                const newline = String.fromCharCode(10);
                return (html || '').split(newline);
            }
        }

        // 各行番号とコード行の物理的な高さを同期する関数
        function syncLineHeights() {
            const codeEl = document.getElementById('source-code');
            const lineNumbersEl = document.getElementById('line-numbers');
            if (!codeEl || !lineNumbersEl) return;

            const codeLines = codeEl.querySelectorAll('.code-line');
            const lineNumbers = lineNumbersEl.querySelectorAll('.line-number');
            
            if (codeLines.length !== lineNumbers.length) return;
            
            for (let i = 0; i < codeLines.length; i++) {
                const height = codeLines[i].getBoundingClientRect().height;
                lineNumbers[i].style.height = height + 'px';
            }
            updateScrollBeyondLastLinePadding();
        }

        // ハイライト済みソースHTMLをコード行ごとにラップして描画する関数
        function normalizeExpectedLineCount(expectedLineCount) {
            const count = Number(expectedLineCount);
            return Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
        }

        function alignLineCount(lines, expectedLineCount) {
            const targetCount = normalizeExpectedLineCount(expectedLineCount);
            if (lines.length < targetCount) {
                for (let i = lines.length; i < targetCount; i++) {
                    lines.push('');
                }
            }
            return lines;
        }

        function updateScrollBeyondLastLinePadding() {
            const sourceContainerEl = document.getElementById('source-container');
            const codeLineEl = document.querySelector('#source-code .code-line');
            if (!sourceContainerEl || !codeLineEl) return;

            const lineHeight = codeLineEl.getBoundingClientRect().height;
            const viewportHeight = sourceContainerEl.clientHeight;
            const minPadding = 22;
            const bottomPadding = Math.max(minPadding, viewportHeight - lineHeight);
            sourceContainerEl.style.setProperty('--mt-scroll-beyond-last-line', bottomPadding + 'px');
        }

        function applySourceTokenThemeVars(themeVars) {
            const sourceContainerEl = document.getElementById('source-container');
            if (!sourceContainerEl || !themeVars || typeof themeVars !== 'object') return;
            for (const key of Object.keys(themeVars)) {
                const value = themeVars[key];
                if (typeof value === 'string' && value.length > 0) {
                    sourceContainerEl.style.setProperty(key, value);
                }
            }
        }

        function renderSourceCode(rawHtml, expectedLineCount) {
            const codeEl = document.getElementById('source-code');
            const lineNumbersEl = document.getElementById('line-numbers');
            if (!codeEl || !lineNumbersEl) return;

            // HTMLを行ごとに安全に分割
            const lines = alignLineCount(splitHtmlIntoLines(rawHtml), expectedLineCount);
            
            let codeHtml = '';
            let lineNumHtml = '';
            
            lines.forEach((line, index) => {
                const displayLine = line.trim() === '' ? '&nbsp;' : line;
                codeHtml += '<div class="code-line">' + displayLine + '</div>';
                lineNumHtml += '<div class="line-number">' + (index + 1) + '</div>';
            });

            codeEl.innerHTML = codeHtml;
            lineNumbersEl.innerHTML = lineNumHtml;

            // 高さを即座に同期
            syncLineHeights();
        }

        // 初期状態で一度レンダリングして高さを同期 (要素存在チェックとtry-catchで極めて安全に)
        try {
            applySourceTokenThemeVars(initialSourceTokenThemeVars);
            const sourceCodeEl = document.getElementById('source-code');
            if (sourceCodeEl) {
                const initialRawHtml = sourceCodeEl.innerHTML;
                renderSourceCode(initialRawHtml, initialSourceLineCount);
            }
        } catch (e) {
            console.error('Error in initial source code render:', e);
        }

        window.addEventListener('resize', syncLineHeights);

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                document.getElementById('preview-container').innerHTML = message.html;
                applySourceTokenThemeVars(message.sourceTokenThemeVars);
                const codeEl = document.getElementById('source-code');
                if (codeEl) {
                    renderSourceCode(message.sourceHtml, message.sourceLineCount);
                }
            } else if (message.type === 'setViewMode') {
                const previewEl = document.getElementById('preview-container');
                const sourceEl = document.getElementById('source-container');
                if (message.mode === 'source') {
                    previewEl.style.display = 'none';
                    sourceEl.style.display = 'flex';
                    // モード切り替え時にレイアウトを確定させて高さを再同期
                    setTimeout(syncLineHeights, 0);
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
