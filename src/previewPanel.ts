import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';
import { Registry, parseRawGrammar, INITIAL, type IGrammar, type IRawGrammar, type IRawTheme, type StateStack } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { TranslationManager } from './translationManager';
import { getTargetLanguageCode } from './languages';
import { t } from './i18n';
import { isCursor } from './utils';
import { markdownTwinWebviewPlugin } from './preview/markdownTwinWebviewPlugin';
import { SourceThemeResolver } from './preview/sourceThemeResolver';

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
  private _tmRegistry: Registry | null = null;
  private _tmGrammar: IGrammar | null = null;
  private _tmGrammarScopeName: string | null = null;
  private _tmThemeId: string | null = null;
  private _tmScopeToPath = new Map<string, string>();
  private _tmOnigReadyPromise: Promise<void> | null = null;
  private _themeResolver = new SourceThemeResolver();

  public get editorDocumentUri(): vscode.Uri {
    return this._editor.document.uri;
  }

  public get editorDocument(): vscode.TextDocument {
    return this._editor.document;
  }

  public get viewColumn(): vscode.ViewColumn | undefined {
    return this._panel.viewColumn;
  }

  public get viewMode(): 'preview' | 'source' {
    return this._viewMode;
  }

  public static getActivePanel(): PreviewPanel | undefined {
    if (PreviewPanel.currentPanel?._panel.active) {
      return PreviewPanel.currentPanel;
    }

    const active = Array.from(PreviewPanel.allPanels.values()).find(panel => panel._panel.active);
    if (active) {
      PreviewPanel.currentPanel = active;
      active._syncShowingSourceContext();
      return active;
    }

    return PreviewPanel.currentPanel;
  }

  public setViewMode(mode: 'preview' | 'source'): void {
    this._viewMode = mode;
    this._panel.webview.postMessage({ type: 'setViewMode', mode });
    this._syncShowingSourceContext();
  }

  private _syncShowingSourceContext(): void {
    vscode.commands.executeCommand('setContext', 'markdownTwin.showingSource', this._viewMode === 'source');
  }

  private static async resolveEditorForDocument(
    document: vscode.TextDocument
  ): Promise<vscode.TextEditor | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.uri.toString() === document.uri.toString()) {
      return activeEditor;
    }

    const visibleEditor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === document.uri.toString()
    );
    if (visibleEditor) {
      return visibleEditor;
    }

    try {
      return await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: true
      });
    } catch {
      return undefined;
    }
  }

  public static async createOrShow(
    extensionUri: vscode.Uri,
    translationManager: TranslationManager,
    document?: vscode.TextDocument
  ): Promise<boolean> {
    const activeEditor = document
      ? await PreviewPanel.resolveEditorForDocument(document)
      : vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.languageId !== 'markdown') {
      vscode.window.showErrorMessage(t('noActiveEditor'));
      return false;
    }

    const code = getTargetLanguageCode();

    const uriStr = activeEditor.document.uri.toString();
    const panelKey = `${uriStr}@${code}`;

    const column = activeEditor.viewColumn;
    const targetColumn = column ? column + 1 : vscode.ViewColumn.Two;
    // `${documentUri}@${langCode}` ???????????????????????
    const existing = PreviewPanel.allPanels.get(panelKey);
    if (existing) {
      PreviewPanel.currentPanel = existing;
      existing._syncShowingSourceContext();
      if (!isCursor()) {
        existing._panel.reveal(targetColumn);
      }
      return true;
    }

    // ????????+??????????????????????????
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
    return true;
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

    // ?????????????????????????
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.active) {
          PreviewPanel.currentPanel = this;
          this._syncShowingSourceContext();
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
        // ???????: Webview -> ????
        if (message.command === 'scroll') {
          this._handleScrollMessage(message.line);
        }
      },
      null,
      this._disposables
    );

    vscode.workspace.onDidChangeTextDocument(
      e => {
        // ???????????????????????????
        if (e.document.uri.toString() === this._editor.document.uri.toString()) {
          if (this._isSameDocAsActive) {
            this._update();
          }
        }
      },
      null,
      this._disposables
    );

    vscode.workspace.onDidChangeConfiguration(
      e => {
        // ????????????????????????
        if (e.affectsConfiguration('workbench.colorTheme') && this._isSameDocAsActive) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeTextEditorVisibleRanges(
      e => {
        // ???????: ???? -> Webview
        if (e.textEditor === this._editor && e.visibleRanges.length > 0) {
          const topLine = e.visibleRanges[0].start.line;
          this._panel.webview.postMessage({ type: 'scroll', line: topLine });
        }
      },
      null,
      this._disposables
    );

    this._disposables.push(
      this.translationManager.onTranslationUpdated((updatedUri) => {
        // ???????????????URI?????????????
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

  private async _update() {
    const webview = this._panel.webview;
    const document = this._editor.document;
    const text = document.getText();

    const md = new MarkdownIt({ html: true });

    md.use((mdInstance) => {
      const originalRender = mdInstance.renderer.render;
      mdInstance.renderer.render = function (tokens: any[], options: any, env: any) {
        // ?????????????????????????????
        for (const token of tokens) {
          if (token.map && token.nesting === 1) {
            const line = token.map[0];
            token.attrSet('data-line', line.toString());
          }
        }
        return originalRender.apply(this, [tokens, options, env]);
      };
    });

    // ??????????????/?????????????
    md.use(markdownTwinWebviewPlugin, { translationManager: this.translationManager, document, langCode: this.langCode });

    const renderedHtml = md.render(text);

    // source?????????Markdown??????
    const sourceMarkdown = this.translationManager.generateTranslatedMarkdown(document, this.langCode);
    let highlightedSource = this._escapeHtml(sourceMarkdown);
    
    const sourceLineCount = sourceMarkdown.split(/\r?\n/).length;
    const editorOptions = this._editor.options as { lineHeight?: number };
    const sourceLineHeight = typeof editorOptions.lineHeight === 'number' && editorOptions.lineHeight > 0
      ? editorOptions.lineHeight
      : 22;
    try {
      highlightedSource = await this._highlightSourceMarkdownWithTextMate(sourceMarkdown);
    } catch (err: any) {
      // ????????????????????????
      this.translationManager.logWarning(`TextMate source highlight fallback: ${err?.message ?? String(err)}`);
    }
    const sourceTokenThemeVars = this._resolveSourceTokenThemeVars();

    if (!this._isInitialized) {
      const twinCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown-twin.css'))
      );
      const markdownCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown.css'))
      );
      webview.html = this._getHtmlForWebview(
        webview,
        renderedHtml,
        highlightedSource,
        sourceMarkdown,
        sourceLineCount,
        sourceLineHeight,
        sourceTokenThemeVars,
        markdownCssUri,
        twinCssUri
      );
      this._isInitialized = true;
    } else {
      webview.postMessage({
        type: 'update',
        html: renderedHtml,
        sourceHtml: highlightedSource,
        sourceText: sourceMarkdown,
        sourceLineCount,
        sourceLineHeight,
        sourceTokenThemeVars
      });
    }
  }

  private async _highlightSourceMarkdownWithTextMate(sourceMarkdown: string): Promise<string> {
    const ready = await this._ensureTextMateReady();
    if (!ready || !this._tmGrammar || !this._tmRegistry) {
      // ??/???????????????????????????????
      return this._escapeHtml(sourceMarkdown);
    }

    const lines = sourceMarkdown.split(/\r?\n/);
    const colorMap = this._tmRegistry.getColorMap();
    const renderedLines: string[] = [];
    let ruleStack: StateStack | null = INITIAL;

    for (const line of lines) {
      const result = this._tmGrammar.tokenizeLine2(line, ruleStack);
      ruleStack = result.ruleStack;
      renderedLines.push(this._renderTextMateLine(line, result.tokens, colorMap));
    }

    return renderedLines.join('\n');
  }

  private _renderTextMateLine(line: string, binaryTokens: Uint32Array, colorMap: string[]): string {
    if (line.length === 0 || binaryTokens.length === 0) {
      return '';
    }

    let html = '';
    for (let i = 0; i < binaryTokens.length; i += 2) {
      const startIndex = binaryTokens[i];
      const metadata = binaryTokens[i + 1];
      const endIndex = (i + 2 < binaryTokens.length) ? binaryTokens[i + 2] : line.length;
      if (endIndex <= startIndex) continue;

      const raw = line.slice(startIndex, endIndex);
      if (!raw) continue;

      const style = this._styleFromTokenMetadata(metadata, colorMap);
      const escaped = this._escapeHtml(raw);
      html += style ? `<span style="${style}">${escaped}</span>` : escaped;
    }
    return html;
  }

  private _styleFromTokenMetadata(metadata: number, colorMap: string[]): string {
    const foregroundId = this._metadataForeground(metadata);
    const fontStyle = this._metadataFontStyle(metadata);
    const styles: string[] = [];

    // ?????????????
    // ??????Webview/??????????????
    const color = colorMap[foregroundId];
    if (foregroundId > 1 && color) styles.push(`color:${color}`);
    if (fontStyle & 1) styles.push('font-style:italic');
    if (fontStyle & 2) styles.push('font-weight:700');
    if (fontStyle & 4) styles.push('text-decoration:underline');
    if (fontStyle & 8) styles.push('text-decoration:line-through');

    return styles.join(';');
  }

  private _metadataFontStyle(metadata: number): number {
    return (metadata >>> 11) & 0b1111;
  }

  private _metadataForeground(metadata: number): number {
    return (metadata >>> 15) & 0x1ff;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async _ensureTextMateReady(): Promise<boolean> {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
    if (this._tmRegistry && this._tmGrammar && this._tmThemeId === themeId) {
      // ???????????????????????registry/grammar???????
      return true;
    }

    const markdownGrammarInfo = this._resolveMarkdownGrammar();
    if (!markdownGrammarInfo) return false;

    await this._ensureOnigWasmLoaded();

    const theme = this._createTextMateTheme(themeId);
    this._tmRegistry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
        createOnigString: (s: string) => new OnigString(s),
      }),
      theme,
      loadGrammar: async (scopeName: string): Promise<IRawGrammar | null> => {
        const grammarPath = this._tmScopeToPath.get(scopeName);
        if (!grammarPath || !fs.existsSync(grammarPath)) return null;
        const raw = fs.readFileSync(grammarPath, 'utf8');
        return parseRawGrammar(raw, grammarPath);
      },
    });

    this._tmGrammar = await this._tmRegistry.loadGrammar(markdownGrammarInfo.scopeName);
    this._tmGrammarScopeName = markdownGrammarInfo.scopeName;
    this._tmThemeId = themeId;
    return !!this._tmGrammar;
  }

  private async _ensureOnigWasmLoaded(): Promise<void> {
    if (!this._tmOnigReadyPromise) {
      this._tmOnigReadyPromise = (async () => {
        const onigWasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
        const wasmFile = fs.readFileSync(onigWasmPath);
        const wasmBytes = wasmFile.buffer.slice(
          wasmFile.byteOffset,
          wasmFile.byteOffset + wasmFile.byteLength
        );
        await loadWASM(wasmBytes);
      })();
    }
    await this._tmOnigReadyPromise;
  }

  private _resolveMarkdownGrammar(): { scopeName: string; grammarPath: string } | null {
    // ????Markdown?????????????scope????????????
    this._tmScopeToPath = this._buildScopeToGrammarPathMap();
    const markdownExt = vscode.extensions.getExtension('vscode.markdown-language-features');
    if (markdownExt) {
      const grammars = markdownExt.packageJSON?.contributes?.grammars;
      if (Array.isArray(grammars)) {
        const mdGrammar = grammars.find((g: any) =>
          g?.language === 'markdown' || String(g?.scopeName ?? '').toLowerCase().includes('markdown')
        );
        if (mdGrammar?.scopeName && mdGrammar?.path) {
          const grammarPath = path.join(markdownExt.extensionUri.fsPath, mdGrammar.path);
          this._tmScopeToPath.set(mdGrammar.scopeName, grammarPath);
          return { scopeName: mdGrammar.scopeName, grammarPath };
        }
      }
    }

    for (const [scopeName, grammarPath] of this._tmScopeToPath.entries()) {
      if (scopeName.toLowerCase().includes('markdown')) {
        return { scopeName, grammarPath };
      }
    }

    return null;
  }

  private _buildScopeToGrammarPathMap(): Map<string, string> {
    // ??????????? scope->grammar ????????????
    const map = new Map<string, string>();
    for (const ext of vscode.extensions.all) {
      const grammars = ext.packageJSON?.contributes?.grammars;
      if (!Array.isArray(grammars)) continue;
      for (const grammar of grammars) {
        const scopeName = grammar?.scopeName;
        const grammarPath = grammar?.path;
        if (!scopeName || !grammarPath) continue;
        map.set(scopeName, path.join(ext.extensionUri.fsPath, grammarPath));
      }
    }
    return map;
  }

  private _resolveSourceTokenThemeVars(): Record<string, string> {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
    return this._themeResolver.resolveTokenThemeVars(themeId);
  }

  private _createTextMateTheme(themeId: string): IRawTheme {
    return this._themeResolver.createTextMateTheme(themeId);
  }

  public dispose() {
    const uriStr = this._editor.document.uri.toString();
    const panelKey = `${uriStr}@${this.langCode}`;
    PreviewPanel.allPanels.delete(panelKey);

    if (PreviewPanel.currentPanel === this) {
      const remaining = Array.from(PreviewPanel.allPanels.values());
      PreviewPanel.currentPanel = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
      if (PreviewPanel.currentPanel) {
        PreviewPanel.currentPanel._syncShowingSourceContext();
      } else {
        vscode.commands.executeCommand('setContext', 'markdownTwin.showingSource', false);
      }
    } else if (PreviewPanel.allPanels.size === 0) {
      vscode.commands.executeCommand('setContext', 'markdownTwin.showingSource', false);
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
    sourceText: string,
    sourceLineCount: number,
    sourceLineHeight: number,
    sourceTokenThemeVars: Record<string, string>,
    markdownCssUri: vscode.Uri,
    twinCssUri: vscode.Uri
  ) {
    const isPreview = this._viewMode === 'preview';
    const isSource = this._viewMode === 'source';

    return `<!DOCTYPE html>
<html lang="en" class="${isSource ? 'mt-source-mode' : 'mt-preview-mode'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Twin Preview</title>
    <link rel="stylesheet" href="${markdownCssUri}">
    <link rel="stylesheet" href="${twinCssUri}">
</head>
<body class="${isSource ? 'mt-source-mode' : 'mt-preview-mode'}">
    <div id="preview-container" style="display: ${isPreview ? 'block' : 'none'};">${renderedHtml}</div>

    <div id="source-container" style="display: ${isSource ? 'flex' : 'none'};">
        <div id="line-numbers"></div>
        <pre class="language-markdown"><code class="language-markdown" id="source-code">${highlightedSource}</code></pre>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isSyncingScroll = false;
        let scrollTimeout;
        const initialSourceLineCount = ${sourceLineCount};
        const initialSourceLineHeight = ${sourceLineHeight};
        const initialSourceText = ${JSON.stringify(sourceText)};
        const initialSourceTokenThemeVars = ${JSON.stringify(sourceTokenThemeVars)};
        const initialViewMode = '${isSource ? 'source' : 'preview'}';
        const collapsedFoldStarts = new Set();
        let foldRangeByStart = new Map();
        let latestSourceLines = [];

        function applyViewModeLayout(mode) {
            const root = document.documentElement;
            const body = document.body;
            const isSourceMode = mode === 'source';
            root.classList.toggle('mt-source-mode', isSourceMode);
            body.classList.toggle('mt-source-mode', isSourceMode);
            root.classList.toggle('mt-preview-mode', !isSourceMode);
            body.classList.toggle('mt-preview-mode', !isSourceMode);
        }

        function applySourceEditorMetrics(lineHeight) {
            const px = Number(lineHeight);
            if (!Number.isFinite(px) || px <= 0) return;
            const root = document.documentElement;
            root.style.setProperty('--mt-source-line-height', px + 'px');
        }

        function isTransparentColor(value) {
            const normalized = String(value || '').trim().toLowerCase();
            if (!normalized) return true;
            if (normalized === 'transparent') return true;
            if (normalized === '#0000') return true;
            if (normalized === 'rgba(0, 0, 0, 0)' || normalized === 'rgba(0,0,0,0)') return true;
            return false;
        }

        function resolveFoldBackgroundColor() {
            const style = getComputedStyle(document.documentElement);
            const candidates = [
                '--vscode-editor-foldBackground',
                '--vscode-list-hoverBackground',
                '--vscode-editor-selectionHighlightBackground',
                '--vscode-editor-selectionBackground',
            ];
            for (const name of candidates) {
                const value = style.getPropertyValue(name);
                if (!isTransparentColor(value)) {
                    return value.trim();
                }
            }
            return 'rgba(128, 128, 128, 0.22)';
        }

        function applyResolvedFoldBackground() {
            const sourceContainer = document.getElementById('source-container');
            if (!sourceContainer) return;
            sourceContainer.style.setProperty('--mt-fold-bg', resolveFoldBackgroundColor());
        }

        function isOrderedListLine(rawLine) {
            return /^\\s*\\d+\\.\\s/.test(rawLine);
        }

        function parseSourceLines(sourceText, expectedLineCount) {
            const raw = typeof sourceText === 'string' ? sourceText : '';
            const lines = raw.split(/\\r?\\n/);
            return alignLineCount(lines, expectedLineCount);
        }

        function detectFoldRanges(sourceLines) {
            // ??????????:
            // 1) fenced code block
            // 2) ??????
            const ranges = [];
            const headingStack = [];
            let fenceStart = -1;
            let fenceMarkerChar = '';
            let fenceMarkerLen = 0;
            const trimTrailingBlankLines = (start, end) => {
                let trimmedEnd = end;
                while (trimmedEnd > start && (sourceLines[trimmedEnd] || '').trim() === '') {
                    trimmedEnd--;
                }
                return trimmedEnd;
            };

            for (let i = 0; i < sourceLines.length; i++) {
                const rawLine = sourceLines[i] || '';
                const trimmed = rawLine.trim();

                if (fenceStart >= 0) {
                    if (trimmed.startsWith(fenceMarkerChar.repeat(fenceMarkerLen))) {
                        const end = trimTrailingBlankLines(fenceStart, i);
                        if (end > fenceStart) {
                            ranges.push({ start: fenceStart, end });
                        }
                        fenceStart = -1;
                        fenceMarkerChar = '';
                        fenceMarkerLen = 0;
                    }
                    continue;
                }

                const fenceMatch = trimmed.match(/^([\\x60~]{3,})/);
                if (fenceMatch) {
                    fenceStart = i;
                    fenceMarkerChar = fenceMatch[1][0];
                    fenceMarkerLen = fenceMatch[1].length;
                    continue;
                }

                const headingMatch = rawLine.match(/^\\s{0,3}(#{1,6})\\s+\\S/);
                if (!headingMatch) {
                    continue;
                }

                const level = headingMatch[1].length;
                while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
                    const prev = headingStack.pop();
                    const end = trimTrailingBlankLines(prev.start, i - 1);
                    if (end > prev.start) {
                        ranges.push({ start: prev.start, end });
                    }
                }
                headingStack.push({ start: i, level });
            }

            if (fenceStart >= 0) {
                const end = trimTrailingBlankLines(fenceStart, sourceLines.length - 1);
                if (end > fenceStart) {
                    ranges.push({ start: fenceStart, end });
                }
            }

            while (headingStack.length > 0) {
                const prev = headingStack.pop();
                const end = trimTrailingBlankLines(prev.start, sourceLines.length - 1);
                if (end > prev.start) {
                    ranges.push({ start: prev.start, end });
                }
            }

            return ranges;
        }

        function prepareFoldState(sourceLines) {
            const ranges = detectFoldRanges(sourceLines);
            foldRangeByStart = new Map(ranges.map(range => [range.start, range]));
            const validStarts = new Set(ranges.map(range => range.start));
            for (const start of Array.from(collapsedFoldStarts)) {
                if (!validStarts.has(start)) {
                    collapsedFoldStarts.delete(start);
                }
            }
        }

        function isLineHiddenByFold(lineNumber) {
            for (const start of collapsedFoldStarts) {
                const range = foldRangeByStart.get(start);
                if (!range) continue;
                if (lineNumber > range.start && lineNumber <= range.end) {
                    return true;
                }
            }
            return false;
        }

        function buildFoldToggleHtml(lineNumber) {
            const range = foldRangeByStart.get(lineNumber);
            if (!range) {
                return '<button class="fold-toggle fold-toggle-spacer" type="button" tabindex="-1" aria-hidden="true"></button>';
            }
            const collapsed = collapsedFoldStarts.has(lineNumber);
            const stateClass = collapsed ? ' is-collapsed' : '';
            const title = collapsed ? 'Expand folded region' : 'Collapse region';
            return '<button class="fold-toggle' + stateClass + '" type="button" data-fold-start="' + lineNumber + '" aria-expanded="' + (!collapsed) + '" title="' + title + '"></button>';
        }

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

        function renderSourceCode(rawHtml, sourceText, expectedLineCount) {
            const codeEl = document.getElementById('source-code');
            const lineNumbersEl = document.getElementById('line-numbers');
            if (!codeEl || !lineNumbersEl) return;

            const htmlLines = alignLineCount(splitHtmlIntoLines(rawHtml), expectedLineCount);
            const sourceLines = parseSourceLines(sourceText, expectedLineCount);
            latestSourceLines = sourceLines;
            prepareFoldState(sourceLines);

            let codeHtml = '';
            let lineNumHtml = '';

            sourceLines.forEach((rawLine, index) => {
                const highlightedLine = htmlLines[index] || '';
                const displayLine = highlightedLine.trim() === '' ? '&nbsp;' : highlightedLine;
                const collapsedStart = foldRangeByStart.has(index) && collapsedFoldStarts.has(index);
                const hiddenByFold = isLineHiddenByFold(index);
                const styleAttr = hiddenByFold ? ' style="display:none;"' : '';
                const classes = ['code-line'];
                if (isOrderedListLine(rawLine)) {
                    classes.push('ordered-list-line');
                }
                if (collapsedStart) {
                    classes.push('fold-collapsed-start');
                }
                const summaryHtml = collapsedStart
                  ? '<span class="folded-summary" title="Collapsed region">'
                    + '<span class="code-line-content">' + displayLine + '</span>'
                    + '<button class="fold-ellipsis" type="button" data-fold-open="' + index + '" title="Expand folded region">...</button>'
                    + '</span>'
                  : '<span class="code-line-content">' + displayLine + '</span>';

                codeHtml += '<div class="' + classes.join(' ') + '" data-line="' + index + '"' + styleAttr + '>'
                  + buildFoldToggleHtml(index)
                  + summaryHtml
                  + '</div>';
                lineNumHtml += '<div class="line-number" data-line="' + index + '"' + styleAttr + '>' + (index + 1) + '</div>';
            });

            codeEl.innerHTML = codeHtml;
            lineNumbersEl.innerHTML = lineNumHtml;
            bindFoldToggleEvents();
            syncLineHeights();
        }

        function setFoldCollapsed(startLine, collapsed) {
            if (collapsed) {
                collapsedFoldStarts.add(startLine);
            } else {
                collapsedFoldStarts.delete(startLine);
            }
        }

        function applyFoldStateToDom() {
            const codeLines = Array.from(document.querySelectorAll('#source-code .code-line'));
            const lineNumbers = Array.from(document.querySelectorAll('#line-numbers .line-number'));

            for (const lineEl of codeLines) {
                const lineNumber = parseInt(lineEl.getAttribute('data-line') || '-1', 10);
                const hidden = isLineHiddenByFold(lineNumber);
                lineEl.style.display = hidden ? 'none' : '';

                const toggleEl = lineEl.querySelector('.fold-toggle[data-fold-start]');
                if (toggleEl) {
                    const startLine = parseInt(toggleEl.getAttribute('data-fold-start') || '-1', 10);
                    const collapsed = collapsedFoldStarts.has(startLine);
                    toggleEl.classList.toggle('is-collapsed', collapsed);
                    toggleEl.setAttribute('aria-expanded', String(!collapsed));
                    toggleEl.setAttribute('title', collapsed ? 'Expand folded region' : 'Collapse region');
                }

                const isCollapsedStart = foldRangeByStart.has(lineNumber) && collapsedFoldStarts.has(lineNumber);
                lineEl.classList.toggle('fold-collapsed-start', isCollapsedStart);
            }

            for (const numEl of lineNumbers) {
                const lineNumber = parseInt(numEl.getAttribute('data-line') || '-1', 10);
                const hidden = isLineHiddenByFold(lineNumber);
                numEl.style.display = hidden ? 'none' : '';
            }

            syncLineHeights();
        }

        function bindFoldToggleEvents() {
            const toggles = document.querySelectorAll('#source-code .fold-toggle[data-fold-start]');
            for (const toggle of toggles) {
                toggle.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startLine = parseInt(toggle.getAttribute('data-fold-start') || '-1', 10);
                    if (!Number.isFinite(startLine) || startLine < 0) return;
                    const collapsed = collapsedFoldStarts.has(startLine);
                    setFoldCollapsed(startLine, !collapsed);
                    applyFoldStateToDom();
                });
            }

            const ellipsisButtons = document.querySelectorAll('#source-code .fold-ellipsis[data-fold-open]');
            for (const ellipsis of ellipsisButtons) {
                ellipsis.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startLine = parseInt(ellipsis.getAttribute('data-fold-open') || '-1', 10);
                    if (!Number.isFinite(startLine) || startLine < 0) return;
                    if (!foldRangeByStart.has(startLine) || !collapsedFoldStarts.has(startLine)) return;
                    setFoldCollapsed(startLine, false);
                    applyFoldStateToDom();
                });
            }
        }

        try {
            applyViewModeLayout(initialViewMode);
            applySourceEditorMetrics(initialSourceLineHeight);
            applyResolvedFoldBackground();
            applySourceTokenThemeVars(initialSourceTokenThemeVars);
            const sourceCodeEl = document.getElementById('source-code');
            if (sourceCodeEl) {
                const initialRawHtml = sourceCodeEl.innerHTML;
                renderSourceCode(initialRawHtml, initialSourceText, initialSourceLineCount);
            }
        } catch (e) {
            console.error('Error in initial source code render:', e);
        }

        window.addEventListener('resize', syncLineHeights);

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                document.getElementById('preview-container').innerHTML = message.html;
                applySourceEditorMetrics(message.sourceLineHeight);
                applyResolvedFoldBackground();
                applySourceTokenThemeVars(message.sourceTokenThemeVars);
                const codeEl = document.getElementById('source-code');
                if (codeEl) {
                    renderSourceCode(message.sourceHtml, message.sourceText, message.sourceLineCount);
                }
            } else if (message.type === 'setViewMode') {
                const previewEl = document.getElementById('preview-container');
                const sourceEl = document.getElementById('source-container');
                applyViewModeLayout(message.mode);
                if (message.mode === 'source') {
                    previewEl.style.display = 'none';
                    sourceEl.style.display = 'flex';
                    // DOM??????????????????1tick?????
                    setTimeout(syncLineHeights, 0);
                } else {
                    previewEl.style.display = 'block';
                    sourceEl.style.display = 'none';
                }
            } else if (message.type === 'scroll') {
                const line = message.line;
                scrollToLine(line);
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

        const sourceContainerEl = document.getElementById('source-container');
        if (sourceContainerEl) {
            sourceContainerEl.addEventListener('scroll', () => {
                if (isSyncingScroll) return;
                if (!isSourceModeActive()) return;
                const lineEl = findSourceLineAtTop();
                if (!lineEl) return;
                const line = parseInt(lineEl.getAttribute('data-line'), 10);
                if (Number.isFinite(line)) {
                    vscode.postMessage({ command: 'scroll', line });
                }
            });
        }

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

        function findSourceLineByLine(line) {
            const elements = Array.from(document.querySelectorAll('#source-code .code-line[data-line]'));
            if (elements.length === 0) return null;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                if (el.style.display === 'none') continue;
                const elLine = parseInt(el.getAttribute('data-line'), 10);
                if (!Number.isFinite(elLine)) continue;
                if (elLine === line) return el;
                const diff = line - elLine;
                if (diff >= 0 && diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest || elements.find(el => el.style.display !== 'none') || null;
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

        function findSourceLineAtTop() {
            const sourceContainer = document.getElementById('source-container');
            if (!sourceContainer) return null;
            const elements = Array.from(document.querySelectorAll('#source-code .code-line[data-line]'));
            if (elements.length === 0) return null;
            const viewportTop = sourceContainer.scrollTop;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                if (el.style.display === 'none') continue;
                const diff = Math.abs(el.offsetTop - viewportTop);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest;
        }

        function isSourceModeActive() {
            return document.body.classList.contains('mt-source-mode');
        }

        function scrollToLine(line) {
            if (isSourceModeActive()) {
                const sourceContainer = document.getElementById('source-container');
                const sourceLine = findSourceLineByLine(line);
                if (!sourceContainer || !sourceLine) return;
                isSyncingScroll = true;
                sourceContainer.scrollTop = sourceLine.offsetTop;
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
                return;
            }

            const previewElement = findElementByLine(line);
            if (!previewElement) return;
            isSyncingScroll = true;
            previewElement.scrollIntoView({ behavior: 'auto', block: 'start' });
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
        }
    </script>
</body>
</html>`;
  }
}
