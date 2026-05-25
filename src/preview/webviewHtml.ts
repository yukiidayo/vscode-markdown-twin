import * as vscode from 'vscode';
import { buildPreviewWebviewScript } from './webviewScript';

export interface BuildPreviewWebviewHtmlArgs {
  renderedHtml: string;
  highlightedSource: string;
  sourceText: string;
  sourceLineCount: number;
  sourceLineHeight: number;
  sourceTokenThemeVars: Record<string, string>;
  markdownCssUri: vscode.Uri;
  twinCssUri: vscode.Uri;
  cspSource: string;
  scriptNonce: string;
  viewMode: 'preview' | 'source';
}

export function buildPreviewWebviewHtml(args: BuildPreviewWebviewHtmlArgs): string {
  const {
    renderedHtml,
    highlightedSource,
    sourceText,
    sourceLineCount,
    sourceLineHeight,
    sourceTokenThemeVars,
    markdownCssUri,
    twinCssUri,
    cspSource,
    scriptNonce,
    viewMode
  } = args;

  const isPreview = viewMode === 'preview';
  const isSource = viewMode === 'source';
  const script = buildPreviewWebviewScript({
    sourceLineCount,
    sourceLineHeight,
    sourceText,
    sourceTokenThemeVars,
    isSource,
  });

  return `<!DOCTYPE html>
<html lang="en" class="${isSource ? 'mt-source-mode' : 'mt-preview-mode'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${scriptNonce}';">
    <title>Markdown Twin Preview</title>
    <link rel="stylesheet" href="${markdownCssUri}">
    <link rel="stylesheet" href="${twinCssUri}">
</head>
<body class="${isSource ? 'mt-source-mode' : 'mt-preview-mode'}">
    <div id="preview-container" style="display: ${isPreview ? 'block' : 'none'};">${renderedHtml}</div>

    <div id="source-container" style="display: ${isSource ? 'flex' : 'none'};">
        <div id="line-numbers"></div>
        <pre class="language-markdown"><code class="language-markdown" id="source-code">${highlightedSource}</code></pre>
    </div>

    <script nonce="${scriptNonce}">
${script}
    </script>
</body>
</html>`;
}
