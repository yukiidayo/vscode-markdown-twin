import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { ITranslationProvider, PROVIDER_DISPLAY_NAMES, PROVIDER_ID_BY_NAME } from './providers/ITranslationProvider';
import { DeeplProvider } from './providers/deeplProvider';
import { PapagoProvider } from './providers/papagoProvider';
import { GoogleCloudProvider } from './providers/googleCloudProvider';
import { MicrosoftProvider, AzureRegionError } from './providers/microsoftProvider';
import { ApiKeyManager } from './apiKeyManager';
import { StatusBar } from './statusBar';
import { shouldTranslate, splitTranslatableParts, joinTranslatedParts, EXCLUDED_TOKEN_TYPES } from './languageDetector';
import { getLanguageISO } from './languages';
import { t } from './i18n';
import { PreviewPanel } from './previewPanel';

type Mode = 'translation-only' | 'bilingual';

export class TranslationManager implements vscode.Disposable {
  // 原文テキスト -> 翻訳テキストの翻訳メモリキャッシュ
  // Map<uriString@langCode, Map<originalText, translatedText>>
  private cache = new Map<string, Map<string, string>>();
  private translationActive = false;
  private translatingNow = false;
  private currentMode: Mode = 'translation-only';
  private statusBar: StatusBar | null = null;
  private md = new MarkdownIt();
  private currentTranslationSessionId = 0;
  private outputChannel = vscode.window.createOutputChannel("Markdown Twin");

  // Webviewの更新連動用イベント
  private onTranslationUpdatedEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  readonly onTranslationUpdated = this.onTranslationUpdatedEmitter.event;

  constructor(private apiKeyManager: ApiKeyManager) {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const rawMode = config.get<string>('defaultMode') ?? 'Translation Only';
    this.currentMode = rawMode === 'Bilingual' ? 'bilingual' : 'translation-only';
    this.logInfo("Markdown Twin active.");
  }



  logWarning(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${timestamp}] [WARN]  ${message}`);
  }

  logError(message: string, error?: any, showOutputHint = true): void {
    const timestamp = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${message}`);
    if (error) {
      this.outputChannel.appendLine(error.stack ?? String(error));
    }
    const suffix = showOutputHint ? t('showOutputHint') : '';
    vscode.window.showErrorMessage(`Markdown Twin: ${message}${suffix}`);
  }

  logInfo(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
  }

  dispose(): void {
    this.debounceTimers.forEach(clearTimeout);
    this.debounceTimers.clear();
    this.outputChannel.dispose();
    this.onTranslationUpdatedEmitter.dispose();
  }

  setStatusBar(statusBar: StatusBar) {
    this.statusBar = statusBar;
  }

  isActive(): boolean {
    return this.translationActive;
  }

  isTranslating(): boolean {
    return this.translatingNow;
  }



  getMode(): Mode {
    return this.currentMode;
  }

  toggleMode(): void {
    this.currentMode =
      this.currentMode === 'translation-only' ? 'bilingual' : 'translation-only';
    this.statusBar?.update(this.currentMode);
    this.onTranslationUpdatedEmitter.fire(undefined); // Webview側へ通知して即時再描画
  }

  // オンデマンドでキャッシュを引き当てて結合し翻訳文を返す
  getTranslation(uri: vscode.Uri, originalContent: string, langCode: string): string | null {
    const cacheKey = `${uri.toString()}@${langCode}`;
    const docCache = this.cache.get(cacheKey);
    if (!docCache) return null;

    const parts = splitTranslatableParts(originalContent);
    const translationSlice = new Map<number, string>();
    let transOffset = 0;
    
    let allTranslated = true;
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k];
      if (part.translate) {
        const cached = docCache.get(part.text);
        if (cached !== undefined) {
          translationSlice.set(transOffset, cached);
        } else {
          allTranslated = false;
        }
        transOffset++;
      }
    }

    if (!allTranslated) return null;

    return joinTranslatedParts(parts, translationSlice);
  }

  async startTranslation(document: vscode.TextDocument, overrideProvider?: string): Promise<void> {
    const sessionId = ++this.currentTranslationSessionId;
    this.translationActive = true;

    const config = vscode.workspace.getConfiguration('markdownTwin');
    // 設定値は表示名（例: "Azure"）なので内部IDに変換。
    // overrideProvider は内部IDで渡される（providerSelector経由）。
    const rawProvider = overrideProvider ?? config.get<string>('provider') ?? 'Azure';
    const providerName = PROVIDER_ID_BY_NAME[rawProvider] ?? rawProvider;

    this.statusBar?.setActiveProvider(providerName);

    const rawSource = config.get<string>('sourceLanguage') ?? 'Japanese (日本語)';
    const rawTarget = config.get<string>('targetLanguage') ?? 'Korean (한국어)';
    const sourceLang = getLanguageISO(rawSource);
    const defaultTargetLang = getLanguageISO(rawTarget);
    const batchSize = config.get<number>('batchSize') ?? 10;

    // 現在オープンされているプレビューパネルの中から、このドキュメント用として開かれている言語だけを動的に対象にする
    const docUriStr = document.uri.toString();
    const panelsForDoc = Array.from(PreviewPanel.allPanels.values()).filter(
      p => p.editorDocumentUri.toString() === docUriStr
    );
    const targetLangs = panelsForDoc.length > 0
      ? panelsForDoc.map(p => p.langCode)
      : [defaultTargetLang];

    const requiresKey = ['deepl', 'papago', 'microsoft', 'google-cloud'].includes(providerName);
    if (requiresKey) {
      const key = await this.apiKeyManager.getKey(providerName);
      if (!key) {
        const displayName = PROVIDER_DISPLAY_NAMES[providerName] ?? providerName;
        this.logError(t('apiKeyNotSetForProvider', displayName), undefined, false);
        this.statusBar?.showError();
        return;
      }
    }

    const provider = await this.buildProvider(providerName);
    if (!provider || this.currentTranslationSessionId !== sessionId) {
      this.statusBar?.showError();
      return;
    }

    const currentTexts = this.extractTranslatableTexts(document);
    const { langToTranslateMap, totalCount } = this.preparePendingTranslations(
      document.uri, targetLangs, currentTexts
    );

    if (totalCount === 0) {
      // すべての言語がキャッシュから引き当てられた場合
      this.statusBar?.showComplete(this.currentMode);
      this.onTranslationUpdatedEmitter.fire(document.uri);
      return;
    }

    await this.executeTranslationLoop(
      sessionId, provider, providerName, document.uri,
      sourceLang, targetLangs, langToTranslateMap, totalCount, batchSize
    );
  }

  /** AST からの翻訳対象テキスト抽出 */
  private extractTranslatableTexts(document: vscode.TextDocument): Set<string> {
    const text = document.getText();
    const tokens = this.md.parse(text, {});
    const result = new Set<string>();

    for (const token of tokens) {
      if (EXCLUDED_TOKEN_TYPES.includes(token.type as any)) continue;
      if (token.type !== 'inline' || !shouldTranslate(token.content)) continue;

      const parts = splitTranslatableParts(token.content);
      for (const part of parts) {
        if (part.translate) result.add(part.text);
      }
    }
    return result;
  }

  /** 言語ごとの未翻訳テキスト検出・キャッシュGC */
  private preparePendingTranslations(
    documentUri: vscode.Uri,
    targetLangs: string[],
    currentTexts: Set<string>
  ): { langToTranslateMap: Map<string, string[]>; totalCount: number } {
    const allTexts = Array.from(currentTexts);
    let totalCount = 0;
    const langToTranslateMap = new Map<string, string[]>();

    for (const targetLang of targetLangs) {
      const uriKey = `${documentUri.toString()}@${targetLang}`;
      if (!this.cache.has(uriKey)) {
        this.cache.set(uriKey, new Map());
      }
      const docCache = this.cache.get(uriKey)!;

      // メモリリーク対策 (GC): ドキュメントに存在しなくなったキャッシュを削除
      for (const cachedText of docCache.keys()) {
        if (!currentTexts.has(cachedText)) docCache.delete(cachedText);
      }

      const pending = allTexts.filter(t => !docCache.has(t));
      langToTranslateMap.set(targetLang, pending);
      totalCount += pending.length;
    }
    return { langToTranslateMap, totalCount };
  }

  /** バッチ非同期API呼び出しと進捗管理 */
  private async executeTranslationLoop(
    sessionId: number,
    provider: ITranslationProvider,
    providerName: string,
    documentUri: vscode.Uri,
    sourceLang: string,
    targetLangs: string[],
    langToTranslateMap: Map<string, string[]>,
    totalCount: number,
    batchSize: number
  ): Promise<void> {
    this.translatingNow = true;
    let accumulatedDone = 0;
    let fatalError = false;
    this.statusBar?.showProgress(accumulatedDone, totalCount);
    this.onTranslationUpdatedEmitter.fire(documentUri); // シマー開始

    try {
      for (const targetLang of targetLangs) {
        if (fatalError || !this.translationActive || this.currentTranslationSessionId !== sessionId) break;
        const textsToTranslate = langToTranslateMap.get(targetLang) ?? [];
        if (textsToTranslate.length === 0) continue;

        const uriKey = `${documentUri.toString()}@${targetLang}`;
        const docCache = this.cache.get(uriKey)!;

        for (let i = 0; i < textsToTranslate.length; i += batchSize) {
          if (fatalError || !this.translationActive || this.currentTranslationSessionId !== sessionId) break;
          const batch = textsToTranslate.slice(i, i + batchSize);

          let translated: string[] = [];
          try {
            translated = await provider.translate(batch, sourceLang, targetLang);
            for (let k = 0; k < batch.length; k++) {
              docCache.set(batch[k], translated[k] ?? batch[k]);
            }
          } catch (err: any) {
            if (err instanceof AzureRegionError) {
              // リージョン設定ミス: 致命的エラーのため「設定を開く」ボタン付き通知を出してループ停止
              const timestamp = new Date().toLocaleTimeString();
              this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${err.message}`);
              fatalError = true;
              this.statusBar?.showError();
              const action = await vscode.window.showErrorMessage(
                t('azureRegionError', err.region ?? 'unknown'),
                t('openSettings')
              );
              if (action === t('openSettings')) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'markdownTwin.azureRegion');
              }
            } else if (err?.name === 'TooManyRequestsError') {
              // レート制限（429）: 一時的な制限のためダイアログは出さずログのみ
              // キャッシュには保存しない（デバウンス後に再試行される）
              this.logWarning(t('rateLimitReached'));
              this.statusBar?.showError();
            } else {
              // 設定ミス・ネットワーク障害など本物のエラー → ダイアログ表示
              this.logError(t('translationFailed', providerName, targetLang), err);
              // フォールバック: 原文をキャッシュに入れてスキップ
              for (let k = 0; k < batch.length; k++) {
                docCache.set(batch[k], batch[k]);
              }
            }
          }

          if (fatalError || this.currentTranslationSessionId !== sessionId) break;

          accumulatedDone += batch.length;
          this.statusBar?.showProgress(accumulatedDone, totalCount);
          this.onTranslationUpdatedEmitter.fire(documentUri);
        }
      }
    } finally {
      if (this.currentTranslationSessionId === sessionId) {
        this.translatingNow = false;
      }
    }

    if (!fatalError && this.translationActive && this.currentTranslationSessionId === sessionId) {
      this.statusBar?.showComplete(this.currentMode);
    }
  }

  // キャッシュを破棄せず、翻訳メモリを維持したまま差分だけを再翻訳する
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  invalidateCache(uri: vscode.Uri): void {
    if (this.translationActive) {
      const uriStr = uri.toString();
      let timer = this.debounceTimers.get(uriStr);
      if (timer) {
        clearTimeout(timer);
      }
      const delay = (vscode.workspace.getConfiguration('markdownTwin').get<number>('debounceDelay') ?? 2) * 1000;
      timer = setTimeout(() => {
        this.debounceTimers.delete(uriStr);
        // activeTextEditor に依存せず、uri から直接ドキュメントを解決する
        const doc = vscode.workspace.textDocuments.find(
          d => d.uri.toString() === uriStr
        );
        if (doc) {
          this.startTranslation(doc);
        }
      }, delay);
      this.debounceTimers.set(uriStr, timer);
    }
  }


  // ファイルが閉じられたときに、メモリを完全にクリーンアップして解放
  closeDocument(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    const timer = this.debounceTimers.get(uriStr);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uriStr);
    }

    const prefix = uriStr + '@';
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.logInfo(`Cache released for closed document (all languages): ${uri.toString()}`);
    }
  }

  // 明示的な停止時はすべてのキャッシュメモリをクリア・解放
  stopTranslation(): void {
    this.translationActive = false;
    this.translatingNow = false;
    this.debounceTimers.forEach(clearTimeout);
    this.debounceTimers.clear();
    this.cache.clear();
    this.currentTranslationSessionId++;
    this.statusBar?.setActiveProvider(null);
    this.statusBar?.showOffline();
    this.onTranslationUpdatedEmitter.fire(undefined);
  }

  // プロバイダー変更時も翻訳セッションと古いキャッシュをクリア
  clearAllCache(): void {
    this.cache.clear();
    this.onTranslationUpdatedEmitter.fire(undefined);
  }

  /** 翻訳キャッシュを適用した完成版Markdownドキュメントの生成 */
  generateTranslatedMarkdown(document: vscode.TextDocument, langCode: string): string {
    const originalText = document.getText();
    const mode = this.getMode();
    const cacheKey = `${document.uri.toString()}@${langCode}`;
    const docCache = this.cache.get(cacheKey);
    if (!docCache) return originalText;

    // 翻訳対象のテキストブロック（原文）を抽出
    const translatableTexts = Array.from(this.extractTranslatableTexts(document));
    
    // 長い文章から順番に置換して部分一致の誤置換を防止
    translatableTexts.sort((a, b) => b.length - a.length);

    let resultMarkdown = originalText;
    for (const text of translatableTexts) {
      const translated = docCache.get(text);
      if (!translated || translated === text) continue;

      if (mode === 'translation-only') {
        resultMarkdown = resultMarkdown.split(text).join(translated);
      } else {
        // 対訳モード: 原文の直後に改行してイタリック形式で翻訳を挿入
        const bilingualReplacement = `${text}\n\n*${translated}*`;
        resultMarkdown = resultMarkdown.split(text).join(bilingualReplacement);
      }
    }
    return resultMarkdown;
  }

  private async buildProvider(name: string): Promise<ITranslationProvider | null> {
    const getKey = async (id: string) => {
      const key = await this.apiKeyManager.getKey(id);
      return key ?? '';
    };
    switch (name) {
      case 'deepl':             return new DeeplProvider(await getKey('deepl'));
      case 'papago':            return new PapagoProvider(await getKey('papago'));
      case 'microsoft':         return new MicrosoftProvider(await getKey('microsoft'));
      case 'google-cloud':  return new GoogleCloudProvider(await getKey('google-cloud'));
      default: return null;
    }
  }
}
