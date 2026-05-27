import * as vscode from 'vscode';
import * as path from 'path';
import { TranslationManager } from './translationManager';
import { getTargetLanguageCode } from './languages';
import { t } from './i18n';
import { isCursor } from './utils';
import { createMarkdownPreviewEngine } from './preview/markdownEngine';
import { buildPreviewWebviewHtml } from './preview/webviewHtml';
import { MarkdownSourceHighlighter } from './preview/sourceHighlighter';
import { runTranslationForDocument } from './translationRunner';
import { escapeHtml } from './utils/html';
import type { TranslatedMarkdownResult } from './translatedMarkdownBuilder';

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function normalizeLineNumber(value: unknown): number {
  const line = Number(value);
  return Number.isFinite(line) && line >= 0 ? Math.floor(line) : 0;
}

function createLocalResourceRoots(extensionUri: vscode.Uri, document: vscode.TextDocument): vscode.Uri[] {
  const roots = [vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))];

  if (document.uri.scheme === 'file') {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    roots.push(workspaceFolder?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath)));
  }

  return roots;
}

function resolveMarkdownResourceUri(
  href: string,
  document: vscode.TextDocument,
  webview: vscode.Webview
): string {
  try {
    if (/^[a-z-]+:/i.test(href)) {
      return /^file:/i.test(href)
        ? webview.asWebviewUri(vscode.Uri.parse(href)).toString(true)
        : href;
    }

    if (document.uri.scheme !== 'file') {
      return href;
    }

    const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(href);
    const resourcePath = decodeURIComponent(match?.[1] ?? href).replace(/\\/g, '/');
    const query = match?.[2]?.slice(1) ?? '';
    const fragment = match?.[3]?.slice(1) ?? '';

    const uri = resourcePath.startsWith('/')
      ? resolveWorkspaceAbsoluteResource(resourcePath, document) ?? vscode.Uri.file(resourcePath)
      : vscode.Uri.joinPath(vscode.Uri.file(path.dirname(document.uri.fsPath)), resourcePath);

    return webview.asWebviewUri(uri.with({ query, fragment })).toString(true);
  } catch {
    return href;
  }
}

function resolveWorkspaceAbsoluteResource(resourcePath: string, document: vscode.TextDocument): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  return workspaceFolder
    ? vscode.Uri.joinPath(workspaceFolder.uri, resourcePath)
    : undefined;
}

function getPreviewBodyClasses(): string[] {
  const classes = ['vscode-body'];
  const previewConfig = vscode.workspace.getConfiguration('markdown.preview');

  if (previewConfig.get<boolean>('markEditorSelection', true)) {
    classes.push('showEditorSelection');
  }
  if (previewConfig.get<boolean>('scrollBeyondLastLine', true)) {
    classes.push('scrollBeyondLastLine');
  }
  if (previewConfig.get<boolean>('wordWrap', true)) {
    classes.push('wordWrap');
  }

  return classes;
}

function getMarkdownStyleVars(): Record<string, string> {
  const previewConfig = vscode.workspace.getConfiguration('markdown.preview');
  const vars: Record<string, string> = {};

  const fontFamily = previewConfig.get<string>('fontFamily');
  if (fontFamily) {
    vars['--markdown-font-family'] = fontFamily;
  }

  const fontSize = previewConfig.get<number>('fontSize');
  if (typeof fontSize === 'number' && fontSize > 0) {
    vars['--markdown-font-size'] = `${fontSize}px`;
  }

  const lineHeight = previewConfig.get<number>('lineHeight');
  if (typeof lineHeight === 'number' && lineHeight > 0) {
    vars['--markdown-line-height'] = String(lineHeight);
  }

  return vars;
}

function shouldScrollPreviewWithEditor(): boolean {
  return vscode.workspace.getConfiguration('markdown.preview').get<boolean>('scrollPreviewWithEditor', true);
}

function shouldScrollEditorWithPreview(): boolean {
  return vscode.workspace.getConfiguration('markdown.preview').get<boolean>('scrollEditorWithPreview', true);
}

export class PreviewPanel {
  public static currentPanel: PreviewPanel | undefined;
  public static readonly allPanels = new Map<string, PreviewPanel>();
  public static readonly viewType = 'markdownTwinPreview';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _editor: vscode.TextEditor;
  private _isInitialized = false;
  private _isDisposed = false;
  private readonly _scriptNonce = createNonce();
  public readonly langCode: string;
  private _viewMode: 'preview' | 'source' = 'preview';
  private _sourceHighlighter = new MarkdownSourceHighlighter();
  private _scrollLeader: 'editor' | 'webview' | null = null;
  private _scrollLeaderUntil = 0;
  private _suppressEditorScrollUntil = 0;
  private _lastSyncedLine = 0;

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
    void this._update();
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

    // `${documentUri}@${langCode}` をキーとしてパネルを一意に管理する。
    const existing = PreviewPanel.allPanels.get(panelKey);
    if (existing) {
      PreviewPanel.currentPanel = existing;
      existing._syncShowingSourceContext();
      if (!isCursor()) {
        existing._panel.reveal(targetColumn);
      }
      return true;
    }

    // 既定ではエディタの右隣にプレビューを開く。
    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      t('previewTitle', path.basename(activeEditor.document.fileName)),
      targetColumn,
      {
        enableScripts: true,
        localResourceRoots: createLocalResourceRoots(extensionUri, activeEditor.document),
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

    // パネルが再びアクティブになったら表示内容を再同期する。
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.active) {
          PreviewPanel.currentPanel = this;
          this._syncShowingSourceContext();
          if (this.translationManager.isActive()) {
            void runTranslationForDocument(this.translationManager, this._editor.document);
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
          if (!shouldScrollEditorWithPreview()) {
            return;
          }
          this._lastSyncedLine = normalizeLineNumber(message.line);
          this._setScrollLeader('webview');
          this._suppressEditorScrollUntil = Date.now() + 220;
          this._handleScrollMessage(this._lastSyncedLine);
        }
      },
      null,
      this._disposables
    );

    vscode.workspace.onDidChangeTextDocument(
      e => {
        // 現在パネルと同じドキュメント変更のみ反映する。
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
        // Markdownプレビュー設定やテーマ変更時は再描画する。
        if (e.affectsConfiguration('markdown.preview') && this._isSameDocAsActive) {
          this._isInitialized = false;
          this._update();
        } else if (e.affectsConfiguration('workbench.colorTheme') && this._isSameDocAsActive) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeTextEditorVisibleRanges(
      e => {
        // スクロール連携: エディタ -> Webview
        if (this._isEditorForDocument(e.textEditor) && e.visibleRanges.length > 0) {
          if (!shouldScrollPreviewWithEditor()) {
            return;
          }
          if (Date.now() < this._suppressEditorScrollUntil || this._hasActiveScrollLeader('webview')) {
            return;
          }
          const topLine = e.visibleRanges[0].start.line;
          this._editor = e.textEditor;
          this._lastSyncedLine = topLine;
          this._setScrollLeader('editor', 180);
          this._panel.webview.postMessage({ type: 'scroll', line: topLine, origin: 'editor' });
        }
      },
      null,
      this._disposables
    );

    this._disposables.push(
      this.translationManager.onTranslationUpdated((updatedUri) => {
        // 全体更新または同一URI更新のときだけ再描画する。
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

  private _setScrollLeader(leader: 'editor' | 'webview', durationMs = 220): void {
    this._scrollLeader = leader;
    this._scrollLeaderUntil = Date.now() + durationMs;
  }

  private _hasActiveScrollLeader(leader: 'editor' | 'webview'): boolean {
    return this._scrollLeader === leader && Date.now() < this._scrollLeaderUntil;
  }

  private _isEditorForDocument(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
    return !!editor && editor.document.uri.toString() === this._editor.document.uri.toString();
  }

  private _handleScrollMessage(line: number) {
    const visibleEditor = vscode.window.visibleTextEditors.find(editor => this._isEditorForDocument(editor));
    if (visibleEditor) {
      this._editor = visibleEditor;
    }
    const range = new vscode.Range(line, 0, line, 0);
    this._editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  }

  private createPreviewMarkdownEngine(translated: TranslatedMarkdownResult): ReturnType<typeof createMarkdownPreviewEngine> {
    const webview = this._panel.webview;
    const document = this._editor.document;
    const previewConfig = vscode.workspace.getConfiguration('markdown.preview');
    return createMarkdownPreviewEngine({
      breaks: previewConfig.get<boolean>('breaks'),
      linkify: previewConfig.get<boolean>('linkify'),
      mapSourceLine: line => translated.lineOrigins[line] ?? line,
      resolveResourceUri: href => resolveMarkdownResourceUri(href, document, webview),
      typographer: previewConfig.get<boolean>('typographer'),
      uriScheme: vscode.env.uriScheme,
    });
  }

  private renderPreviewHtml(translated: TranslatedMarkdownResult): string {
    return this.createPreviewMarkdownEngine(translated).render(translated.text);
  }

  private async renderSourceView(translated: TranslatedMarkdownResult): Promise<{
    highlightedSource: string;
    sourceText: string;
    sourceLineCount: number;
    sourceLineOrigins: number[];
    sourceLineHeight: number;
    sourceHighlightError?: string;
  }> {
    const sourceMarkdown = translated.text;
    let highlightedSource = escapeHtml(sourceMarkdown);
    let sourceHighlightError: string | undefined;
    const sourceLineCount = sourceMarkdown.split(/\r?\n/).length;
    const sourceLineHeight = 19;

    try {
      highlightedSource = await this._sourceHighlighter.highlight(sourceMarkdown);
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      sourceHighlightError = `Source highlight failed: ${reason}`;
      this.translationManager.logError(`Source highlight failed: ${reason}`, err, false);
    }

    return {
      highlightedSource,
      sourceText: sourceMarkdown,
      sourceLineCount,
      sourceLineOrigins: translated.lineOrigins,
      sourceLineHeight,
      sourceHighlightError,
    };
  }

  private emptySourceView(translated: TranslatedMarkdownResult): {
    highlightedSource: string;
    sourceText: string;
    sourceLineCount: number;
    sourceLineOrigins: number[];
    sourceLineHeight: number;
    sourceHighlightError?: string;
  } {
    return {
      highlightedSource: '',
      sourceText: translated.text,
      sourceLineCount: translated.text.split(/\r?\n/).length,
      sourceLineOrigins: translated.lineOrigins,
      sourceLineHeight: 19,
    };
  }

  private async _update() {
    const webview = this._panel.webview;
    const document = this._editor.document;
    const translated = this.translationManager.generateTranslatedMarkdown(document, this.langCode);
    const shouldRenderPreview = this._viewMode === 'preview' || !this._isInitialized;
    const shouldRenderSource = this._viewMode === 'source';
    const renderedHtml = shouldRenderPreview ? this.renderPreviewHtml(translated) : undefined;
    const sourceView = shouldRenderSource
      ? await this.renderSourceView(translated)
      : this.emptySourceView(translated);

    if (!this._isInitialized) {
      const twinCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown-twin.css'))
      );
      const markdownCssUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'markdown.css'))
      );
      webview.html = buildPreviewWebviewHtml({
        previewHeaderTitle: `Twin Preview ${path.basename(document.fileName)}`,
        renderedHtml: renderedHtml ?? '',
        highlightedSource: sourceView.highlightedSource,
        sourceText: sourceView.sourceText,
        sourceLineCount: sourceView.sourceLineCount,
        sourceLineOrigins: sourceView.sourceLineOrigins,
        sourceLineHeight: sourceView.sourceLineHeight,
        initialScrollLine: this._lastSyncedLine,
        sourceHighlightError: sourceView.sourceHighlightError,
        markdownCssUri,
        twinCssUri,
        bodyClasses: getPreviewBodyClasses(),
        htmlStyleVars: getMarkdownStyleVars(),
        cspSource: webview.cspSource,
        scriptNonce: this._scriptNonce,
        viewMode: this._viewMode
      });
      this._isInitialized = true;
    } else {
      webview.postMessage({
        type: 'update',
        html: renderedHtml,
        sourceHtml: shouldRenderSource ? sourceView.highlightedSource : undefined,
        sourceText: shouldRenderSource ? sourceView.sourceText : undefined,
        sourceLineCount: shouldRenderSource ? sourceView.sourceLineCount : undefined,
        sourceLineOrigins: shouldRenderSource ? sourceView.sourceLineOrigins : undefined,
        sourceLineHeight: shouldRenderSource ? sourceView.sourceLineHeight : undefined,
        scrollLine: this._lastSyncedLine,
        sourceHighlightError: shouldRenderSource ? sourceView.sourceHighlightError : undefined
      });
    }
  }

  public dispose() {
    if (this._isDisposed) return;
    this._isDisposed = true;

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

    if (this._disposables.length) {
      while (this._disposables.length) {
        const x = this._disposables.pop();
        if (x) x.dispose();
      }
    }
  }
}
