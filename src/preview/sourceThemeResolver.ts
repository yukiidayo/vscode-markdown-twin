import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { type IRawTheme } from 'vscode-textmate';

type ThemeRule = { scope?: string | string[]; settings?: any };

export class SourceThemeResolver {
  private cachedThemeId: string | null = null;
  private cachedTokenThemeVars: Record<string, string> = {};

  resolveTokenThemeVars(themeId: string): Record<string, string> {
    if (this.cachedThemeId === themeId) {
      // 同一テーマなら計算済みCSS変数を再利用する
      return this.cachedTokenThemeVars;
    }

    this.cachedThemeId = themeId;
    this.cachedTokenThemeVars = this.loadTokenThemeVars(themeId);
    return this.cachedTokenThemeVars;
  }

  createTextMateTheme(themeId: string): IRawTheme {
    // テーマ定義とユーザー上書きを統合してTextMateテーマを組み立てる
    const tokenRules: ThemeRule[] = [];

    const themePath = this.resolveThemeFilePath(themeId);
    if (themePath) {
      tokenRules.push(...this.readThemeTokenRules(themePath));
    }

    tokenRules.push(...this.readCustomizedTokenRules());

    return {
      name: `markdown-twin-${themeId}`,
      settings: tokenRules.map(rule => ({
        scope: rule.scope,
        settings: rule.settings ?? {},
      })),
    };
  }

  private loadTokenThemeVars(themeId: string): Record<string, string> {
    const vars: Record<string, string> = {};
    const rules: ThemeRule[] = [];

    const themePath = this.resolveThemeFilePath(themeId);
    if (themePath) {
      rules.push(...this.readThemeTokenRules(themePath));
    }
    rules.push(...this.readCustomizedTokenRules());

    const add = (key: string, color: string | undefined) => {
      if (!color) return;
      const trimmed = color.trim();
      if (!trimmed) return;
      vars[key] = trimmed;
    };

    add('--mt-token-heading-color', this.pickTokenForeground(rules, ['markup.heading', 'entity.name.section']));
    add('--mt-token-emphasis-color', this.pickTokenForeground(rules, ['markup.italic', 'markup.emphasis']));
    add('--mt-token-strong-color', this.pickTokenForeground(rules, ['markup.bold', 'markup.strong']));
    add('--mt-token-inline-code-color', this.pickTokenForeground(rules, ['markup.inline.raw', 'markup.inline.raw.string.markdown']));
    add('--mt-token-link-text-color', this.pickTokenForeground(rules, ['markup.underline.link.markdown', 'string.other.link.title.markdown']));
    add('--mt-token-link-url-color', this.pickTokenForeground(rules, ['markup.underline.link.image.markdown', 'markup.underline.link', 'meta.link.inline.markdown']));
    add('--mt-token-blockquote-color', this.pickTokenForeground(rules, ['markup.quote', 'markup.quote.markdown']));
    add('--mt-token-list-marker-color', this.pickTokenForeground(rules, ['punctuation.definition.list.begin.markdown', 'markup.list']));
    add('--mt-token-code-block-color', this.pickTokenForeground(rules, ['markup.fenced_code.block.markdown', 'markup.raw.block.markdown']));
    add('--mt-token-hr-color', this.pickTokenForeground(rules, ['meta.separator.markdown', 'punctuation.definition.thematic-break.markdown']));
    add('--mt-token-table-border-color', this.pickTokenForeground(rules, ['punctuation.definition.table.markdown', 'markup.table']));

    return vars;
  }

  private resolveThemeFilePath(themeId: string): string | null {
    const themes = vscode.extensions.all.flatMap(ext => ext.packageJSON?.contributes?.themes ?? []);
    const hit = themes.find((theme: any) => theme?.id === themeId || theme?.label === themeId);
    if (!hit || !hit.path) return null;

    const ext = vscode.extensions.getExtension(hit.extensionId) ?? vscode.extensions.all.find(e => e.id === hit.extensionId);
    if (!ext) return null;

    return path.resolve(ext.extensionPath, hit.path);
  }

  private readThemeTokenRules(themePath: string, visited = new Set<string>()): ThemeRule[] {
    if (visited.has(themePath)) return [];
    visited.add(themePath);

    if (!fs.existsSync(themePath)) return [];

    let themeObj: any;
    try {
      const raw = fs.readFileSync(themePath, 'utf8');
      themeObj = Function('"use strict"; return (' + raw + ');')();
    } catch {
      return [];
    }

    let inherited: ThemeRule[] = [];
    if (themeObj.include) {
      // VS Codeテーマの継承指定 include も再帰で展開する
      const includePath = path.resolve(path.dirname(themePath), themeObj.include);
      inherited = this.readThemeTokenRules(includePath, visited);
    }

    const ownRules = Array.isArray(themeObj.tokenColors) ? themeObj.tokenColors : [];
    return [...inherited, ...ownRules];
  }

  private readCustomizedTokenRules(): ThemeRule[] {
    const custom = vscode.workspace.getConfiguration('editor').get<any>('tokenColorCustomizations');
    if (!custom) return [];

    const result: ThemeRule[] = [];

    if (Array.isArray(custom.textMateRules)) {
      result.push(...custom.textMateRules);
    }

    if (custom['[markdown]'] && Array.isArray(custom['[markdown]'].textMateRules)) {
      result.push(...custom['[markdown]'].textMateRules);
    }

    return result;
  }

  private pickTokenForeground(tokenRules: ThemeRule[], preferredScopes: string[]): string | undefined {
    for (let i = tokenRules.length - 1; i >= 0; i--) {
      const rule = tokenRules[i];
      const scopes = this.normalizeScopes(rule.scope);
      const settings = rule.settings ?? {};

      const hasPreferredScope = preferredScopes.some(preferred =>
        scopes.some(scope => scope === preferred || scope.startsWith(`${preferred}.`))
      );

      if (hasPreferredScope && typeof settings.foreground === 'string') {
        return settings.foreground;
      }
    }

    return undefined;
  }

  private normalizeScopes(scope: string | string[] | undefined): string[] {
    if (!scope) return [];
    if (Array.isArray(scope)) {
      return scope.map(s => String(s).trim()).filter(Boolean);
    }
    return String(scope).split(',').map(s => s.trim()).filter(Boolean);
  }
}
