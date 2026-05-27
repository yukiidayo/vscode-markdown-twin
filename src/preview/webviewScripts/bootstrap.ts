export const WEBVIEW_SCRIPT_BOOTSTRAP = `
        let latestSourceLines = parseSourceLines(initialSourceText, initialSourceLineCount);
        let latestSourceLineOrigins = normalizeSourceLineOrigins(initialSourceLineOrigins, initialSourceLineCount);
        let lastInteractedLine = 0;
        let sourceHeadings = [];
        let sourceStickySignature = '';
        let scrollLeader = null;
        let scrollLeaderUntil = 0;
        let lastSyncedLine = Number.isFinite(Number(initialScrollLine)) ? Number(initialScrollLine) : 0;
        let lastSourceUserScrollIntentAt = 0;
        let lastPreviewUserScrollIntentAt = 0;

        try {
            applyViewModeLayout(initialViewMode);
            applySourceEditorMetrics(initialSourceLineHeight);
            applyResolvedFoldBackground();
            bindSourceScrollbar();
            collectSourceHeadings();
            renderSourceStickyHeadings();
            const sourceCodeEl = document.getElementById('source-code');
            if (sourceCodeEl) {
                const initialRawHtml = sourceCodeEl.innerHTML;
                renderSourceCode(initialRawHtml, initialSourceText, initialSourceLineCount, initialSourceLineOrigins);
            }
            setTimeout(() => scrollToLine(lastSyncedLine), 0);
        } catch (e) {
            console.error('Error in initial source code render:', e);
        }

        window.addEventListener('resize', () => {
            syncLineHeights();
            updateSourceScrollbar();
            renderSourceStickyHeadings(true);
        });

        function setScrollLeader(leader, durationMs) {
            scrollLeader = leader;
            scrollLeaderUntil = Date.now() + (durationMs || 220);
        }

        function hasActiveScrollLeader(leader) {
            return scrollLeader === leader && Date.now() < scrollLeaderUntil;
        }

        function noteWebviewUserScrollIntent(kind) {
            const now = Date.now();
            setScrollLeader('webview', 240);
            if (kind === 'preview') {
                lastPreviewUserScrollIntentAt = now;
                return;
            }
            lastSourceUserScrollIntentAt = now;
        }

        function shouldIgnoreIncomingScroll(message) {
            return message.origin === 'editor' && hasActiveScrollLeader('webview');
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                if (typeof message.html === 'string') {
                    document.getElementById('preview-container').innerHTML = message.html;
                }
                if (typeof message.sourceText === 'string') {
                    latestSourceLines = parseSourceLines(message.sourceText, message.sourceLineCount);
                    latestSourceLineOrigins = normalizeSourceLineOrigins(message.sourceLineOrigins, message.sourceLineCount);
                    collectSourceHeadings();
                    applySourceEditorMetrics(message.sourceLineHeight);
                    applyResolvedFoldBackground();
                    setSourceHighlightError(message.sourceHighlightError);
                    renderSourceStickyHeadings(true);
                }
                const codeEl = document.getElementById('source-code');
                if (codeEl && typeof message.sourceHtml === 'string') {
                    renderSourceCode(message.sourceHtml, message.sourceText, message.sourceLineCount, message.sourceLineOrigins);
                }
                if (Number.isFinite(Number(message.scrollLine))) {
                    lastSyncedLine = Number(message.scrollLine);
                    setTimeout(() => scrollToLine(lastSyncedLine), 0);
                }
            } else if (message.type === 'setViewMode') {
                const previewEl = document.getElementById('preview-container');
                const sourceShellEl = document.getElementById('source-shell');
                applyViewModeLayout(message.mode);
                if (message.mode === 'source') {
                    previewEl.style.display = 'none';
                    sourceShellEl.style.display = 'flex';
                    renderSourceStickyHeadings(true);
                    setTimeout(() => {
                        syncLineHeights();
                        updateSourceScrollbar();
                        renderSourceStickyHeadings(true);
                    }, 0);
                } else {
                    previewEl.style.display = 'block';
                    sourceShellEl.style.display = 'none';
                }
            } else if (message.type === 'scroll') {
                if (shouldIgnoreIncomingScroll(message)) {
                    return;
                }
                setScrollLeader('editor', 160);
                const line = message.line;
                lastSyncedLine = Number.isFinite(Number(line)) ? Number(line) : lastSyncedLine;
                scrollToLine(line);
            }
        });

        window.addEventListener('scroll', () => {
            if (isSyncingScroll) return;
            const previewEl = document.getElementById('preview-container');
            if (previewEl && previewEl.style.display !== 'none') {
                if (Date.now() - lastPreviewUserScrollIntentAt <= 320) {
                    setScrollLeader('webview', 240);
                }
                const element = findElementAtViewportTop();
                if (element) {
                    const line = parseInt(element.getAttribute('data-line'), 10);
                    if (Number.isFinite(line)) {
                        lastSyncedLine = line;
                    }
                    vscode.postMessage({ command: 'scroll', line: line, origin: 'webview', mode: 'preview' });
                }
            }
        });

        const sourceContainerEl = document.getElementById('source-container');
        if (sourceContainerEl) {
            sourceContainerEl.addEventListener('wheel', () => noteWebviewUserScrollIntent('source'), { passive: true });
            sourceContainerEl.addEventListener('mousedown', () => noteWebviewUserScrollIntent('source'), true);
            sourceContainerEl.addEventListener('touchstart', () => noteWebviewUserScrollIntent('source'), { passive: true });
            sourceContainerEl.addEventListener('scroll', () => {
                updateSourceScrollbar();
                if (isSyncingScroll) return;
                if (!isSourceModeActive()) return;
                if (Date.now() - lastSourceUserScrollIntentAt <= 320) {
                    setScrollLeader('webview', 240);
                }
                renderSourceStickyHeadings();
                const lineEl = findSourceLineAtTop();
                if (!lineEl) return;
                const line = parseInt(lineEl.getAttribute('data-line'), 10);
                if (Number.isFinite(line)) {
                    lastSyncedLine = line;
                    vscode.postMessage({ command: 'scroll', line, origin: 'webview', mode: 'source' });
                }
            });
        }

        const previewContainerEl = document.getElementById('preview-container');
        if (previewContainerEl) {
            previewContainerEl.addEventListener('wheel', () => noteWebviewUserScrollIntent('preview'), { passive: true });
            previewContainerEl.addEventListener('mousedown', () => noteWebviewUserScrollIntent('preview'), true);
            previewContainerEl.addEventListener('touchstart', () => noteWebviewUserScrollIntent('preview'), { passive: true });
            previewContainerEl.addEventListener('mousedown', updateLastInteractedLineFromEvent, true);
        }
        bindSourceStickyEvents();

        if (sourceContainerEl) {
            sourceContainerEl.addEventListener('mousedown', updateLastInteractedLineFromEvent, true);
        }

        document.addEventListener('selectionchange', updateLastInteractedLineFromSelection, true);
        document.addEventListener('copy', handleCopyEvent, true);
        document.addEventListener('keydown', (event) => {
            if (!isSourceModeActive() && document.getElementById('preview-container')?.style.display === 'none') {
                return;
            }
            const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space'];
            if (!scrollKeys.includes(event.key)) return;
            noteWebviewUserScrollIntent(isSourceModeActive() ? 'source' : 'preview');
        }, true);
`;
