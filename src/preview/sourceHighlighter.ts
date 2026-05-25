import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Registry, parseRawGrammar, INITIAL, type IGrammar, type IRawGrammar, type IRawTheme, type StateStack } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { SourceThemeResolver } from './sourceThemeResolver';
import { escapeHtml } from '../utils/html';

export class MarkdownSourceHighlighter {
  private tmRegistry: Registry | null = null;
  private tmGrammar: IGrammar | null = null;
  private tmThemeId: string | null = null;
  private tmScopeToPath = new Map<string, string>();
  private tmOnigReadyPromise: Promise<void> | null = null;
  private readonly themeResolver = new SourceThemeResolver();

  async highlight(sourceMarkdown: string): Promise<string> {
    const ready = await this.ensureTextMateReady();
    if (!ready || !this.tmGrammar || !this.tmRegistry) {
      return escapeHtml(sourceMarkdown);
    }

    const lines = sourceMarkdown.split(/\r?\n/);
    const colorMap = this.tmRegistry.getColorMap();
    const renderedLines: string[] = [];
    let ruleStack: StateStack | null = INITIAL;

    for (const line of lines) {
      const result = this.tmGrammar.tokenizeLine2(line, ruleStack);
      ruleStack = result.ruleStack;
      renderedLines.push(this.renderTextMateLine(line, result.tokens, colorMap));
    }

    return renderedLines.join('\n');
  }

  resolveTokenThemeVars(): Record<string, string> {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
    return this.themeResolver.resolveTokenThemeVars(themeId);
  }

  private renderTextMateLine(line: string, binaryTokens: Uint32Array, colorMap: string[]): string {
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

      const style = this.styleFromTokenMetadata(metadata, colorMap);
      const escaped = escapeHtml(raw);
      html += style ? `<span style="${style}">${escaped}</span>` : escaped;
    }
    return html;
  }

  private styleFromTokenMetadata(metadata: number, colorMap: string[]): string {
    const foregroundId = this.metadataForeground(metadata);
    const fontStyle = this.metadataFontStyle(metadata);
    const styles: string[] = [];

    const color = colorMap[foregroundId];
    if (foregroundId > 1 && color) styles.push(`color:${color}`);
    if (fontStyle & 1) styles.push('font-style:italic');
    if (fontStyle & 2) styles.push('font-weight:700');
    if (fontStyle & 4) styles.push('text-decoration:underline');
    if (fontStyle & 8) styles.push('text-decoration:line-through');

    return styles.join(';');
  }

  private metadataFontStyle(metadata: number): number {
    return (metadata >>> 11) & 0b1111;
  }

  private metadataForeground(metadata: number): number {
    return (metadata >>> 15) & 0x1ff;
  }

  private async ensureTextMateReady(): Promise<boolean> {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '';
    if (this.tmRegistry && this.tmGrammar && this.tmThemeId === themeId) {
      return true;
    }

    const markdownGrammarInfo = this.resolveMarkdownGrammar();
    if (!markdownGrammarInfo) return false;

    await this.ensureOnigWasmLoaded();

    const theme = this.createTextMateTheme(themeId);
    this.tmRegistry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
        createOnigString: (s: string) => new OnigString(s),
      }),
      theme,
      loadGrammar: async (scopeName: string): Promise<IRawGrammar | null> => {
        const grammarPath = this.tmScopeToPath.get(scopeName);
        if (!grammarPath || !fs.existsSync(grammarPath)) return null;
        const raw = fs.readFileSync(grammarPath, 'utf8');
        return parseRawGrammar(raw, grammarPath);
      },
    });

    this.tmGrammar = await this.tmRegistry.loadGrammar(markdownGrammarInfo.scopeName);
    this.tmThemeId = themeId;
    return !!this.tmGrammar;
  }

  private async ensureOnigWasmLoaded(): Promise<void> {
    if (!this.tmOnigReadyPromise) {
      this.tmOnigReadyPromise = (async () => {
        const onigWasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
        const wasmFile = fs.readFileSync(onigWasmPath);
        const wasmBytes = wasmFile.buffer.slice(
          wasmFile.byteOffset,
          wasmFile.byteOffset + wasmFile.byteLength
        );
        await loadWASM(wasmBytes);
      })();
    }
    await this.tmOnigReadyPromise;
  }

  private resolveMarkdownGrammar(): { scopeName: string; grammarPath: string } | null {
    this.tmScopeToPath = this.buildScopeToGrammarPathMap();
    const markdownExt = vscode.extensions.getExtension('vscode.markdown-language-features');
    if (markdownExt) {
      const grammars = markdownExt.packageJSON?.contributes?.grammars;
      if (Array.isArray(grammars)) {
        const mdGrammar = grammars.find((g: any) =>
          g?.language === 'markdown' || String(g?.scopeName ?? '').toLowerCase().includes('markdown')
        );
        if (mdGrammar?.scopeName && mdGrammar?.path) {
          const grammarPath = path.join(markdownExt.extensionUri.fsPath, mdGrammar.path);
          this.tmScopeToPath.set(mdGrammar.scopeName, grammarPath);
          return { scopeName: mdGrammar.scopeName, grammarPath };
        }
      }
    }

    for (const [scopeName, grammarPath] of this.tmScopeToPath.entries()) {
      if (scopeName.toLowerCase().includes('markdown')) {
        return { scopeName, grammarPath };
      }
    }

    return null;
  }

  private buildScopeToGrammarPathMap(): Map<string, string> {
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

  private createTextMateTheme(themeId: string): IRawTheme {
    return this.themeResolver.createTextMateTheme(themeId);
  }
}
