import * as vscode from 'vscode';

/**
 * 現在の実行環境が Cursor であるかを判定します。
 */
export function isCursor(): boolean {
  return vscode.env.appName.toLowerCase().includes('cursor');
}
