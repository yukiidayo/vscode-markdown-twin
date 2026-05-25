import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import {
  ITranslationProvider,
  ProviderId,
  PROVIDER_DISPLAY_NAMES,
  normalizeProviderId,
} from './providers/ITranslationProvider';
import { DeeplProvider } from './providers/deeplProvider';
import { PapagoProvider } from './providers/papagoProvider';
import { GoogleCloudProvider } from './providers/googleCloudProvider';
import { MicrosoftProvider, AzureRegionError } from './providers/microsoftProvider';
import { ApiKeyManager } from './apiKeyManager';
import { StatusBar } from './statusBar';
import { shouldTranslate, splitTranslatableParts, joinTranslatedParts, EXCLUDED_TOKEN_TYPES } from './languageDetector';
import { getLanguageISO, normalizeTargetLanguageCode } from './languages';
import { t } from './i18n';
import { PreviewPanel } from './previewPanel';

type Mode = 'translation-only' | 'bilingual';

type Replacement = {
  start: number;
  end: number;
  text: string;
};

export class TranslationManager implements vscode.Disposable {
  // ??????????:
  // Map<`${uri}@${lang}`, Map<??, ???>>
  private cache = new Map<string, Map<string, string>>();
  private translationActive = false;
  private translatingNow = false;
  private currentMode: Mode = 'translation-only';
  private statusBar: StatusBar | null = null;
  private md = new MarkdownIt();
  private currentTranslationSessionId = 0;
  private outputChannel = vscode.window.createOutputChannel('Markdown Twin');

  private onTranslationUpdatedEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  readonly onTranslationUpdated = this.onTranslationUpdatedEmitter.event;

  constructor(private apiKeyManager: ApiKeyManager) {
    const config = vscode.workspace.getConfiguration('markdownTwin');
    const rawMode = config.get<string>('defaultMode') ?? 'Translation Only';
    this.currentMode = rawMode === 'Bilingual' ? 'bilingual' : 'translation-only';
    this.logInfo('Markdown Twin active.');
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
    this.currentMode = this.currentMode === 'translation-only' ? 'bilingual' : 'translation-only';
    this.statusBar?.update(this.currentMode);
    this.onTranslationUpdatedEmitter.fire(undefined);
  }

  getTranslation(uri: vscode.Uri, originalContent: string, langCode: string): string | null {
    const cacheKey = `${uri.toString()}@${langCode}`;
    const docCache = this.cache.get(cacheKey);
    if (!docCache) return null;

    const parts = splitTranslatableParts(originalContent);
    const translationSlice = new Map<number, string>();
    let transOffset = 0;

    let allTranslated = true;
    for (const part of parts) {
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
    const providerId = normalizeProviderId(overrideProvider ?? config.get<string>('provider'));
    this.statusBar?.setActiveProvider(providerId);

    const sourceLang = getLanguageISO(config.get<string>('sourceLanguage') ?? 'ja');
    const defaultTargetLang = normalizeTargetLanguageCode(config.get<string>('targetLanguage'));
    const batchSize = config.get<number>('batchSize') ?? 10;

    const docUriStr = document.uri.toString();
    // ???????????????????????????????
    const panelsForDoc = Array.from(PreviewPanel.allPanels.values()).filter(
      p => p.editorDocumentUri.toString() === docUriStr
    );
    const targetLangs = panelsForDoc.length > 0 ? panelsForDoc.map(p => p.langCode) : [defaultTargetLang];

    const requiresKey = ['deepl', 'papago', 'microsoft', 'google-cloud'].includes(providerId);
    if (requiresKey) {
      const key = await this.apiKeyManager.getKey(providerId);
      if (!key) {
        const displayName = PROVIDER_DISPLAY_NAMES[providerId] ?? providerId;
        this.logError(t('apiKeyNotSetForProvider', displayName), undefined, false);
        this.statusBar?.showError();
        return;
      }
    }

    const provider = await this.buildProvider(providerId);
    if (!provider || this.currentTranslationSessionId !== sessionId) {
      this.statusBar?.showError();
      return;
    }

    const currentTexts = this.extractTranslatableTexts(document);
    const { langToTranslateMap, totalCount } = this.preparePendingTranslations(
      document.uri, targetLangs, currentTexts
    );

    if (totalCount === 0) {
      this.statusBar?.showComplete(this.currentMode);
      this.onTranslationUpdatedEmitter.fire(document.uri);
      return;
    }

    await this.executeTranslationLoop(
      sessionId,
      provider,
      PROVIDER_DISPLAY_NAMES[providerId] ?? providerId,
      document.uri,
      sourceLang,
      targetLangs,
      langToTranslateMap,
      totalCount,
      batchSize
    );
  }

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

      // ??????????????GC??????????????
      for (const cachedText of docCache.keys()) {
        if (!currentTexts.has(cachedText)) docCache.delete(cachedText);
      }

      const pending = allTexts.filter(text => !docCache.has(text));
      langToTranslateMap.set(targetLang, pending);
      totalCount += pending.length;
    }

    return { langToTranslateMap, totalCount };
  }

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
    this.onTranslationUpdatedEmitter.fire(documentUri);

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

          try {
            const translated = await provider.translate(batch, sourceLang, targetLang);
            for (let k = 0; k < batch.length; k++) {
              docCache.set(batch[k], translated[k] ?? batch[k]);
            }
          } catch (err: any) {
            if (err instanceof AzureRegionError) {
              // ???????????????????????????????????
              const timestamp = new Date().toLocaleTimeString();
              this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${err.message}`);
              fatalError = true;
              this.statusBar?.showError();
              const action = await vscode.window.showErrorMessage(
                t('azureRegionError', err.region ?? 'unknown'),
                t('openSettings')
              );
              if (action === t('openSettings')) {
                void vscode.commands.executeCommand('workbench.action.openSettings', 'markdownTwin.azureRegion');
              }
            } else if (err?.name === 'TooManyRequestsError') {
              // ????????????????????????????????????
              this.logWarning(t('rateLimitReached'));
              this.statusBar?.showError();
            } else {
              // ??????????????????????????????????
              this.logError(t('translationFailed', providerName, targetLang), err);
              for (const text of batch) {
                docCache.set(text, text);
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

  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  invalidateCache(uri: vscode.Uri): void {
    if (this.translationActive) {
      const uriStr = uri.toString();
      const existing = this.debounceTimers.get(uriStr);
      if (existing) {
        clearTimeout(existing);
      }

      // ??????URI??????????????API??????????
      const delay = (vscode.workspace.getConfiguration('markdownTwin').get<number>('debounceDelay') ?? 2) * 1000;
      const timer = setTimeout(() => {
        this.debounceTimers.delete(uriStr);
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriStr);
        if (doc) {
          void this.startTranslation(doc);
        }
      }, delay);
      this.debounceTimers.set(uriStr, timer);
    }
  }

  closeDocument(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    const timer = this.debounceTimers.get(uriStr);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uriStr);
    }

    const prefix = `${uriStr}@`;
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

  clearAllCache(): void {
    this.cache.clear();
    this.onTranslationUpdatedEmitter.fire(undefined);
  }

  private collectInlineReplacements(
    document: vscode.TextDocument,
    source: string,
    langCode: string,
    mode: Mode
  ): Replacement[] {
    // AST????????????????????????
    // ?????????????????
    const lineOffsets = this.buildLineOffsets(source);
    const tokens = this.md.parse(source, {});
    const rangeCursor = new Map<string, number>();
    const replacements: Replacement[] = [];

    for (const token of tokens) {
      if (EXCLUDED_TOKEN_TYPES.includes(token.type as any)) continue;
      if (token.type !== 'inline') continue;

      const translation = this.getTranslation(document.uri, token.content, langCode);
      if (!translation || translation === token.content) continue;
      if (!Array.isArray(token.map) || token.map.length < 2) continue;

      const [startLine, endLine] = token.map;
      const rangeStart = lineOffsets[startLine] ?? 0;
      const rangeEnd = lineOffsets[endLine] ?? source.length;
      const rangeKey = `${startLine}:${endLine}`;
      // ?????????????????????????????????????????
      const searchStart = Math.max(rangeStart, rangeCursor.get(rangeKey) ?? rangeStart);

      const hitIndex = source.indexOf(token.content, searchStart);
      if (hitIndex < 0) continue;
      if (hitIndex + token.content.length > rangeEnd) continue;

      rangeCursor.set(rangeKey, hitIndex + token.content.length);

      const replacementText = mode === 'translation-only'
        ? translation
        : `${token.content}\n\n*${translation}*`;

      replacements.push({
        start: hitIndex,
        end: hitIndex + token.content.length,
        text: replacementText,
      });
    }

    return this.normalizeReplacements(replacements);
  }

  private normalizeReplacements(replacements: Replacement[]): Replacement[] {
    // ??????????????????????????????????
    const ordered = replacements.sort((a, b) => {
      if (a.start === b.start) return b.end - a.end;
      return a.start - b.start;
    });

    const result: Replacement[] = [];
    let lastEnd = -1;
    for (const replacement of ordered) {
      if (replacement.start < lastEnd) {
        continue;
      }
      result.push(replacement);
      lastEnd = replacement.end;
    }

    return result;
  }

  private applyReplacements(source: string, replacements: Replacement[]): string {
    // ?????????????????????????????
    let output = source;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const replacement = replacements[i];
      output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
    }
    return output;
  }

  private buildLineOffsets(source: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    offsets.push(source.length);
    return offsets;
  }

  generateTranslatedMarkdown(document: vscode.TextDocument, langCode: string): string {
    const originalText = document.getText();
    const cacheKey = `${document.uri.toString()}@${langCode}`;
    const docCache = this.cache.get(cacheKey);
    if (!docCache || docCache.size === 0) return originalText;

    const replacements = this.collectInlineReplacements(document, originalText, langCode, this.getMode());
    if (replacements.length === 0) return originalText;

    return this.applyReplacements(originalText, replacements);
  }

  private async buildProvider(id: ProviderId): Promise<ITranslationProvider | null> {
    const getKey = async (providerId: ProviderId) => {
      const key = await this.apiKeyManager.getKey(providerId);
      return key ?? '';
    };

    switch (id) {
      case 'deepl':
        return new DeeplProvider(await getKey('deepl'));
      case 'papago':
        return new PapagoProvider(await getKey('papago'));
      case 'microsoft':
        return new MicrosoftProvider(await getKey('microsoft'));
      case 'google-cloud':
        return new GoogleCloudProvider(await getKey('google-cloud'));
      default:
        return null;
    }
  }
}
