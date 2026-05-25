import {
  WEBVIEW_SCRIPT_FOLDING,
  WEBVIEW_SCRIPT_SHARED,
  WEBVIEW_SCRIPT_SOURCE_RENDERING,
  WEBVIEW_SCRIPT_SYNC,
} from './webviewScriptSections';

export interface BuildPreviewWebviewScriptArgs {
  sourceLineCount: number;
  sourceLineHeight: number;
  sourceText: string;
  sourceTokenThemeVars: Record<string, string>;
  isSource: boolean;
}

export function buildPreviewWebviewScript(args: BuildPreviewWebviewScriptArgs): string {
  const { sourceLineCount, sourceLineHeight, sourceText, sourceTokenThemeVars, isSource } = args;

  return `<script>
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
${WEBVIEW_SCRIPT_SHARED}
${WEBVIEW_SCRIPT_FOLDING}
${WEBVIEW_SCRIPT_SOURCE_RENDERING}
${WEBVIEW_SCRIPT_SYNC}
    </script>`;
}
