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
import { buildPreviewWebviewHtml } from './preview/webviewHtml';
import { SourceThemeResolver } from './preview/sourceThemeResolver';
import { triggerTranslationForDocument } from './translationTrigger';
import { escapeHtml } from './utils/html';

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
    // `${documentUri}@${langCode}` をキーとしてパネルを一意に管理する
    const existing = PreviewPanel.allPanels.get(panelKey);
    if (existing) {
      PreviewPanel.currentPanel = existing;
      existing._syncShowingSourceContext();
      if (!isCursor()) {
        existing._panel.reveal(targetColumn);
      }
      return true;
    }

    // 既定はエディタの右隣にプレビューを開く
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

    // パネルが再びアクティブになったら表示内容を再同期する
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.active) {
          PreviewPanel.currentPanel = this;
          this._syncShowingSourceContext();
          if (this.translationManager.isActive()) {
            void triggerTranslationForDocument(this.translationManager, this._editor.document);
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
        // メッセージ連携: Webview -> 拡張
        if (message.command === 'scroll') {
          this._handleScrollMessage(message.line);
        }
      },
      null,
      this._disposables
    );

    vscode.workspace.onDidChangeTextDocument(
      e => {
        // 現在パネルと同じドキュメント変更のみ反映する
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
        // テーマ変更時は再ハイライトのため再描画する
        if (e.affectsConfiguration('workbench.colorTheme') && this._isSameDocAsActive) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeTextEditorVisibleRanges(
      e => {
        // スクロール連携: エディタ -> Webview
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
        // 全体更新または同一URI更新のときだけ再描画する
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
        // 各ブロック先頭行を data-line に埋め込み、スクロール同期に使う
        for (const token of tokens) {
          if (token.map && token.nesting === 1) {
            const line = token.map[0];
            token.attrSet('data-line', line.toString());
          }
        }
        return originalRender.apply(this, [tokens, options, env]);
      };
    });

    // 翻訳結果を埋め込むためのWebview専用プラグイン
    md.use(markdownTwinWebviewPlugin, { translationManager: this.translationManager, document, langCode: this.langCode });

    const renderedHtml = md.render(text);

    // sourceモード用の翻訳済みMarkdownを生成する
    const sourceMarkdown = this.translationManager.generateTranslatedMarkdown(document, this.langCode);
    let highlightedSource = escapeHtml(sourceMarkdown);
    
    const sourceLineCount = sourceMarkdown.split(/\r?\n/).length;
    const editorOptions = this._editor.options as { lineHeight?: number };
    const sourceLineHeight = typeof editorOptions.lineHeight === 'number' && editorOptions.lineHeight > 0
      ? editorOptions.lineHeight
      : 22;
    try {
      highlightedSource = await this._highlightSourceMarkdownWithTextMate(sourceMarkdown);
    } catch (err: any) {
      // ハイライト失敗時はプレーンエスケープ表示にフォールバック
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
      webview.html = buildPreviewWebviewHtml({
        renderedHtml,
        highlightedSource,
        sourceText: sourceMarkdown,
        sourceLineCount,
        sourceLineHeight,
        sourceTokenThemeVars,
        markdownCssUri,
        twinCssUri,
        viewMode: this._viewMode
      });
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
      // テーマ/文法が未準備なら最低限のHTMLエスケープで返す
      return escapeHtml(sourceMarkdown);
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
      const escaped = escapeHtml(raw);
      html += style ? `<span style="${style}">${escaped}</span>` : escaped;
    }
    return html;
  }

  private _styleFromTokenMetadata(metadata: number, colorMap: string[]): string {
    const foregroundId = this._metadataForeground(metadata);
    const fontStyle = this._metadataFontStyle(metadata);
    const styles: string[] = [];

    // TextMateのメタデータをCSSへ変換する
    // 背景色はWebview/CSS側の管理に任せる
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

  private async _ensureTextMateReady(): Promise<boolean> {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
    if (this._tmRegistry && this._tmGrammar && this._tmThemeId === themeId) {
      // 既存テーマのままならregistry/grammarを再利用する
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
    // まずMarkdown拡張の寄与情報からscopeを優先解決する
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
    // 全拡張から scope->grammar の対応表を構築する
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

}
