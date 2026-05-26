import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { type IRawTheme } from 'vscode-textmate';

type ThemeRule = { scope?: string | string[]; settings?: any };

export class SourceThemeResolver {
  createTextMateTheme(themeId: string): IRawTheme {
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

  private resolveThemeFilePath(themeId: string): string | null {
    for (const ext of vscode.extensions.all) {
      const themes = ext.packageJSON?.contributes?.themes;
      if (!Array.isArray(themes)) continue;

      const hit = themes.find((theme: any) => theme?.id === themeId || theme?.label === themeId);
      if (!hit?.path) continue;

      return path.resolve(ext.extensionPath, hit.path);
    }

    return null;
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
}
