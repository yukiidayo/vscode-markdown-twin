import * as vscode from 'vscode';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import { TranslationManager } from './translationManager';
import { getTargetLanguageCode } from './languages';
import { t } from './i18n';
import { isCursor } from './utils';
import { markdownTwinWebviewPlugin } from './preview/markdownTwinWebviewPlugin';
import { buildPreviewWebviewHtml } from './preview/webviewHtml';
import { MarkdownSourceHighlighter } from './preview/sourceHighlighter';
import { runTranslationForDocument } from './translationRunner';
import { escapeHtml } from './utils/html';

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
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
          this._handleScrollMessage(message.line);
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
        // テーマ変更時は再ハイライトのため再描画する。
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
        // 各ブロック先頭行を data-line に埋め込み、スクロール同期に使う。
        for (const token of tokens) {
          if (token.map && token.nesting === 1) {
            const line = token.map[0];
            token.attrSet('data-line', line.toString());
          }
        }
        return originalRender.apply(this, [tokens, options, env]);
      };
    });

    // 翻訳結果を埋め込むためのWebview専用プラグイン。
    md.use(markdownTwinWebviewPlugin, { translationManager: this.translationManager, document, langCode: this.langCode });

    const renderedHtml = md.render(text);

    // sourceモード用の翻訳済みMarkdownを生成する。
    const sourceMarkdown = this.translationManager.generateTranslatedMarkdown(document, this.langCode);
    let highlightedSource = escapeHtml(sourceMarkdown);

    const sourceLineCount = sourceMarkdown.split(/\r?\n/).length;
    const editorOptions = this._editor.options as { lineHeight?: number };
    const sourceLineHeight = typeof editorOptions.lineHeight === 'number' && editorOptions.lineHeight > 0
      ? editorOptions.lineHeight
      : 22;

    try {
      highlightedSource = await this._sourceHighlighter.highlight(sourceMarkdown);
    } catch (err: any) {
      this.translationManager.logWarning(`TextMate source highlight fallback: ${err?.message ?? String(err)}`);
    }

    const sourceTokenThemeVars = this._sourceHighlighter.resolveTokenThemeVars();

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
        cspSource: webview.cspSource,
        scriptNonce: this._scriptNonce,
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
