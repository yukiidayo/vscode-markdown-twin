export const WEBVIEW_SCRIPT_SHARED = `
        function applyViewModeLayout(mode) {
            const root = document.documentElement;
            const body = document.body;
            const isSourceMode = mode === 'source';
            root.classList.toggle('mt-source-mode', isSourceMode);
            body.classList.toggle('mt-source-mode', isSourceMode);
            root.classList.toggle('mt-preview-mode', !isSourceMode);
            body.classList.toggle('mt-preview-mode', !isSourceMode);
        }

        function applySourceEditorMetrics(lineHeight) {
            const px = Number(lineHeight);
            if (!Number.isFinite(px) || px <= 0) return;
            const root = document.documentElement;
            root.style.setProperty('--mt-source-line-height', px + 'px');
        }

        function isTransparentColor(value) {
            const normalized = String(value || '').trim().toLowerCase();
            if (!normalized) return true;
            if (normalized === 'transparent') return true;
            if (normalized === '#0000') return true;
            if (normalized === 'rgba(0, 0, 0, 0)' || normalized === 'rgba(0,0,0,0)') return true;
            return false;
        }

        function resolveFoldBackgroundColor() {
            const style = getComputedStyle(document.documentElement);
            const candidates = [
                '--vscode-editor-foldBackground',
                '--vscode-list-hoverBackground',
                '--vscode-editor-selectionHighlightBackground',
                '--vscode-editor-selectionBackground',
            ];
            for (const name of candidates) {
                const value = style.getPropertyValue(name);
                if (!isTransparentColor(value)) {
                    return value.trim();
                }
            }
            return 'rgba(128, 128, 128, 0.22)';
        }

        function applyResolvedFoldBackground() {
            const sourceContainer = document.getElementById('source-container');
            if (!sourceContainer) return;
            sourceContainer.style.setProperty('--mt-fold-bg', resolveFoldBackgroundColor());
        }

        function isOrderedListLine(rawLine) {
            return /^\\s*\\d+\\.\\s/.test(rawLine);
        }

        function parseSourceLines(sourceText, expectedLineCount) {
            const raw = typeof sourceText === 'string' ? sourceText : '';
            const lines = raw.split(/\\r?\\n/);
            return alignLineCount(lines, expectedLineCount);
        }

        function normalizeSourceLineOrigins(lineOrigins, expectedLineCount) {
            const targetCount = normalizeExpectedLineCount(expectedLineCount);
            const normalized = Array.isArray(lineOrigins)
                ? lineOrigins.map((value, index) => {
                    const line = Number(value);
                    return Number.isFinite(line) && line >= 0 ? Math.floor(line) : index;
                })
                : [];
            if (normalized.length < targetCount) {
                const fallback = normalized.length > 0 ? normalized[normalized.length - 1] : 0;
                for (let i = normalized.length; i < targetCount; i++) {
                    normalized.push(fallback);
                }
            }
            return normalized.slice(0, targetCount);
        }

        function normalizeExpectedLineCount(expectedLineCount) {
            const count = Number(expectedLineCount);
            return Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
        }

        function alignLineCount(lines, expectedLineCount) {
            const targetCount = normalizeExpectedLineCount(expectedLineCount);
            if (lines.length < targetCount) {
                for (let i = lines.length; i < targetCount; i++) {
                    lines.push('');
                }
            }
            return lines;
        }

        function updateScrollBeyondLastLinePadding() {
            const sourceContainerEl = document.getElementById('source-container');
            const codeLineEl = document.querySelector('#source-code .code-line');
            if (!sourceContainerEl || !codeLineEl) return;

            const lineHeight = codeLineEl.getBoundingClientRect().height;
            const viewportHeight = sourceContainerEl.clientHeight;
            const minPadding = 22;
            const bottomPadding = Math.max(minPadding, viewportHeight - lineHeight);
            sourceContainerEl.style.setProperty('--mt-scroll-beyond-last-line', bottomPadding + 'px');
        }

        function setSourceHighlightError(message) {
            const banner = document.getElementById('mt-source-highlight-error');
            if (!banner) return;
            const text = typeof message === 'string' ? message.trim() : '';
            if (!text) {
                banner.style.display = 'none';
                banner.textContent = '';
                return;
            }
            banner.style.display = 'block';
            banner.textContent = text;
        }

        function getSourceStickyParts() {
            const sticky = document.getElementById('mt-source-sticky');
            const content = document.getElementById('mt-source-sticky-content');
            return { sticky, content };
        }

        function parseSourceHeading(rawLine, lineNumber) {
            const match = String(rawLine || '').match(/^\\s{0,3}(#{1,6})\\s+(.+?)\\s*#*\\s*$/);
            if (!match) return null;
            return {
                level: match[1].length,
                line: lineNumber,
                text: match[2].trim().replace(/\\s+/g, ' '),
            };
        }

        function getSourceScrollbarParts() {
            const sourceContainer = document.getElementById('source-container');
            const scrollbar = document.getElementById('mt-source-scrollbar');
            const track = document.getElementById('mt-source-scrollbar-track');
            const thumb = document.getElementById('mt-source-scrollbar-thumb');
            return { sourceContainer, scrollbar, track, thumb };
        }

        function updateSourceScrollbar() {
            const { sourceContainer, scrollbar, track, thumb } = getSourceScrollbarParts();
            if (!sourceContainer || !scrollbar || !track || !thumb) return;

            const maxScroll = sourceContainer.scrollHeight - sourceContainer.clientHeight;
            if (!Number.isFinite(maxScroll) || maxScroll <= 0) {
                scrollbar.classList.add('is-inactive');
                thumb.style.height = '0px';
                thumb.style.transform = 'translateY(0px)';
                return;
            }

            const trackHeight = track.clientHeight;
            if (!Number.isFinite(trackHeight) || trackHeight <= 0) {
                scrollbar.classList.add('is-inactive');
                return;
            }

            scrollbar.classList.remove('is-inactive');

            const minThumbHeight = 24;
            const rawThumbHeight = Math.floor((sourceContainer.clientHeight / sourceContainer.scrollHeight) * trackHeight);
            const thumbHeight = Math.max(minThumbHeight, Math.min(trackHeight, rawThumbHeight));
            const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
            const progress = Math.max(0, Math.min(1, sourceContainer.scrollTop / maxScroll));
            const thumbTop = Math.round(progress * maxThumbTop);

            thumb.style.height = thumbHeight + 'px';
            thumb.style.transform = 'translateY(' + thumbTop + 'px)';
        }

        function bindSourceScrollbar() {
            const { sourceContainer, scrollbar, track, thumb } = getSourceScrollbarParts();
            if (!sourceContainer || !scrollbar || !track || !thumb) return;
            if (scrollbar.dataset.mtBound === '1') return;
            scrollbar.dataset.mtBound = '1';

            let dragging = false;
            let dragPointerOffset = 0;

            const stopDrag = () => {
                if (!dragging) return;
                dragging = false;
                document.body.classList.remove('mt-scrollbar-dragging');
            };

            const dragToClientY = (clientY) => {
                const rect = track.getBoundingClientRect();
                const maxScroll = sourceContainer.scrollHeight - sourceContainer.clientHeight;
                if (maxScroll <= 0) return;

                const thumbHeight = thumb.offsetHeight;
                const maxThumbTop = Math.max(0, rect.height - thumbHeight);
                const nextThumbTop = Math.max(0, Math.min(maxThumbTop, clientY - rect.top - dragPointerOffset));
                const progress = maxThumbTop > 0 ? nextThumbTop / maxThumbTop : 0;
                sourceContainer.scrollTop = progress * maxScroll;
                updateSourceScrollbar();
            };

            thumb.addEventListener('mousedown', (event) => {
                event.preventDefault();
                event.stopPropagation();
                noteWebviewUserScrollIntent('source');
                const thumbRect = thumb.getBoundingClientRect();
                dragging = true;
                dragPointerOffset = event.clientY - thumbRect.top;
                document.body.classList.add('mt-scrollbar-dragging');
            });

            track.addEventListener('mousedown', (event) => {
                if (event.target === thumb) return;
                event.preventDefault();
                noteWebviewUserScrollIntent('source');
                dragPointerOffset = thumb.offsetHeight / 2;
                dragToClientY(event.clientY);
            });

            window.addEventListener('mousemove', (event) => {
                if (!dragging) return;
                dragToClientY(event.clientY);
            });

            window.addEventListener('mouseup', stopDrag);
            window.addEventListener('mouseleave', stopDrag);

            sourceContainer.addEventListener('scroll', updateSourceScrollbar, { passive: true });
            updateSourceScrollbar();
        }

        function bindFoldRailHoverState() {
            const rail = document.getElementById('line-numbers');
            if (!rail || rail.dataset.mtFoldRailBound === '1') return;
            rail.dataset.mtFoldRailBound = '1';

            rail.addEventListener('mouseover', (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                if (!target.closest('.line-number-fold-slot')) return;
                rail.classList.add('mt-fold-rail-hover');
            });

            rail.addEventListener('mouseout', (event) => {
                const to = event.relatedTarget;
                if (to instanceof Element && rail.contains(to) && to.closest('.line-number-fold-slot')) {
                    return;
                }
                rail.classList.remove('mt-fold-rail-hover');
            });
        }
`;

export const WEBVIEW_SCRIPT_FOLDING = `
        function detectFoldRanges(sourceLines) {
            const ranges = [];
            const headingStack = [];
            let fenceStart = -1;
            let fenceMarkerChar = '';
            let fenceMarkerLen = 0;
            const trimTrailingBlankLines = (start, end) => {
                let trimmedEnd = end;
                while (trimmedEnd > start && (sourceLines[trimmedEnd] || '').trim() === '') {
                    trimmedEnd--;
                }
                return trimmedEnd;
            };

            for (let i = 0; i < sourceLines.length; i++) {
                const rawLine = sourceLines[i] || '';
                const trimmed = rawLine.trim();

                if (fenceStart >= 0) {
                    if (trimmed.startsWith(fenceMarkerChar.repeat(fenceMarkerLen))) {
                        const end = trimTrailingBlankLines(fenceStart, i);
                        if (end > fenceStart) {
                            ranges.push({ start: fenceStart, end });
                        }
                        fenceStart = -1;
                        fenceMarkerChar = '';
                        fenceMarkerLen = 0;
                    }
                    continue;
                }

                const fenceMatch = trimmed.match(/^([\\x60~]{3,})/);
                if (fenceMatch) {
                    fenceStart = i;
                    fenceMarkerChar = fenceMatch[1][0];
                    fenceMarkerLen = fenceMatch[1].length;
                    continue;
                }

                const headingMatch = rawLine.match(/^\\s{0,3}(#{1,6})\\s+\\S/);
                if (!headingMatch) {
                    continue;
                }

                const level = headingMatch[1].length;
                while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
                    const prev = headingStack.pop();
                    const end = trimTrailingBlankLines(prev.start, i - 1);
                    if (end > prev.start) {
                        ranges.push({ start: prev.start, end });
                    }
                }
                headingStack.push({ start: i, level });
            }

            if (fenceStart >= 0) {
                const end = trimTrailingBlankLines(fenceStart, sourceLines.length - 1);
                if (end > fenceStart) {
                    ranges.push({ start: fenceStart, end });
                }
            }

            while (headingStack.length > 0) {
                const prev = headingStack.pop();
                const end = trimTrailingBlankLines(prev.start, sourceLines.length - 1);
                if (end > prev.start) {
                    ranges.push({ start: prev.start, end });
                }
            }

            return ranges;
        }

        function prepareFoldState(sourceLines) {
            const ranges = detectFoldRanges(sourceLines);
            foldRangeByStart = new Map(ranges.map(range => [range.start, range]));
            const validStarts = new Set(ranges.map(range => range.start));
            for (const start of Array.from(collapsedFoldStarts)) {
                if (!validStarts.has(start)) {
                    collapsedFoldStarts.delete(start);
                }
            }
        }

        function isLineHiddenByFold(lineNumber) {
            for (const start of collapsedFoldStarts) {
                const range = foldRangeByStart.get(start);
                if (!range) continue;
                if (lineNumber > range.start && lineNumber <= range.end) {
                    return true;
                }
            }
            return false;
        }

        function buildFoldToggleHtml(lineNumber) {
            const range = foldRangeByStart.get(lineNumber);
            if (!range) {
                return '<button class="fold-toggle fold-toggle-spacer" type="button" tabindex="-1" aria-hidden="true"></button>';
            }
            const collapsed = collapsedFoldStarts.has(lineNumber);
            const stateClass = collapsed ? ' is-collapsed' : '';
            const title = collapsed ? 'Expand folded region' : 'Collapse region';
            return '<button class="fold-toggle' + stateClass + '" type="button" data-fold-start="' + lineNumber + '" aria-expanded="' + (!collapsed) + '" title="' + title + '"></button>';
        }

        function resolveFoldState(lineNumber) {
            if (!foldRangeByStart.has(lineNumber)) {
                return 'none';
            }
            return collapsedFoldStarts.has(lineNumber) ? 'collapsed' : 'expanded';
        }

        function setFoldCollapsed(startLine, collapsed) {
            if (collapsed) {
                collapsedFoldStarts.add(startLine);
            } else {
                collapsedFoldStarts.delete(startLine);
            }
        }

        function applyFoldStateToDom() {
            const codeLines = Array.from(document.querySelectorAll('#source-code .code-line'));
            const lineNumbers = Array.from(document.querySelectorAll('#line-numbers .line-number'));

            for (const lineEl of codeLines) {
                const sourceIndex = parseInt(lineEl.getAttribute('data-source-index') || '-1', 10);
                const hidden = isLineHiddenByFold(sourceIndex);
                lineEl.style.display = hidden ? 'none' : '';

                const foldState = resolveFoldState(sourceIndex);
                lineEl.dataset.foldState = foldState;
            }

            for (const numEl of lineNumbers) {
                const sourceIndex = parseInt(numEl.getAttribute('data-source-index') || '-1', 10);
                const hidden = isLineHiddenByFold(sourceIndex);
                numEl.style.display = hidden ? 'none' : '';
                const foldState = resolveFoldState(sourceIndex);
                numEl.dataset.foldState = foldState;

                const toggleEl = numEl.querySelector('.fold-toggle[data-fold-start]');
                if (toggleEl) {
                    const startLine = parseInt(toggleEl.getAttribute('data-fold-start') || '-1', 10);
                    const collapsed = collapsedFoldStarts.has(startLine);
                    toggleEl.classList.toggle('is-collapsed', collapsed);
                    toggleEl.setAttribute('aria-expanded', String(!collapsed));
                    toggleEl.setAttribute('title', collapsed ? 'Expand folded region' : 'Collapse region');
                }
            }

            syncLineHeights();
        }

        function bindFoldToggleEvents() {
            const toggles = document.querySelectorAll('#line-numbers .fold-toggle[data-fold-start]');
            for (const toggle of toggles) {
                toggle.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startLine = parseInt(toggle.getAttribute('data-fold-start') || '-1', 10);
                    if (!Number.isFinite(startLine) || startLine < 0) return;
                    const collapsed = collapsedFoldStarts.has(startLine);
                    setFoldCollapsed(startLine, !collapsed);
                    applyFoldStateToDom();
                });
            }

            const ellipsisButtons = document.querySelectorAll('#source-code .fold-ellipsis[data-fold-open]');
            for (const ellipsis of ellipsisButtons) {
                const openFold = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startLine = parseInt(ellipsis.getAttribute('data-fold-open') || '-1', 10);
                    if (!Number.isFinite(startLine) || startLine < 0) return;
                    if (!foldRangeByStart.has(startLine) || !collapsedFoldStarts.has(startLine)) return;
                    setFoldCollapsed(startLine, false);
                    applyFoldStateToDom();
                };

                ellipsis.addEventListener('click', openFold);
                ellipsis.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    openFold(event);
                });
            }
        }
`;

export const WEBVIEW_SCRIPT_SOURCE_RENDERING = `
        function splitHtmlIntoLines(html) {
            try {
                const lines = [];
                let currentLine = '';
                const tagStack = [];
                const regex = /(<[^>]+>|[^<]+)/g;
                let match;

                while ((match = regex.exec(html)) !== null) {
                    const token = match[0];
                    if (token.startsWith('<')) {
                        if (token.startsWith('<' + '/')) {
                            tagStack.pop();
                            currentLine += token;
                        } else {
                            if (!token.endsWith('/>') && !token.startsWith('<!--')) {
                                const tagNameMatch = token.match(/<([a-zA-Z0-9]+)/);
                                if (tagNameMatch) {
                                    tagStack.push(token);
                                }
                            }
                            currentLine += token;
                        }
                    } else {
                        const newline = String.fromCharCode(10);
                        const textLines = token.split(newline);
                        for (let i = 0; i < textLines.length; i++) {
                            if (i > 0) {
                                let closeTags = '';
                                for (let j = tagStack.length - 1; j >= 0; j--) {
                                    const openTag = tagStack[j];
                                    const tagMatch = openTag.match(/<([a-zA-Z0-9]+)/);
                                    const tagName = tagMatch ? tagMatch[1] : '';
                                    if (tagName) {
                                        closeTags += '<' + '/' + tagName + '>';
                                    }
                                }
                                currentLine += closeTags;
                                lines.push(currentLine);

                                let openTags = '';
                                for (let j = 0; j < tagStack.length; j++) {
                                    openTags += tagStack[j];
                                }
                                currentLine = openTags;
                            }
                            currentLine += textLines[i];
                        }
                    }
                }
                if (currentLine) {
                    lines.push(currentLine);
                }
                return lines;
            } catch (err) {
                console.error('Error splitting HTML into lines:', err);
                const newline = String.fromCharCode(10);
                return (html || '').split(newline);
            }
        }

        function syncLineHeights() {
            const codeEl = document.getElementById('source-code');
            const lineNumbersEl = document.getElementById('line-numbers');
            if (!codeEl || !lineNumbersEl) {
                updateSourceScrollbar();
                return;
            }

            const codeLines = codeEl.querySelectorAll('.code-line');
            const lineNumbers = lineNumbersEl.querySelectorAll('.line-number');

            if (codeLines.length !== lineNumbers.length) {
                updateScrollBeyondLastLinePadding();
                updateSourceScrollbar();
                return;
            }

            for (let i = 0; i < codeLines.length; i++) {
                const height = codeLines[i].getBoundingClientRect().height;
                lineNumbers[i].style.height = height + 'px';
            }
            updateScrollBeyondLastLinePadding();
            updateSourceScrollbar();
        }

        function renderSourceCode(rawHtml, sourceText, expectedLineCount, sourceLineOrigins) {
            const codeEl = document.getElementById('source-code');
            const lineNumbersEl = document.getElementById('line-numbers');
            if (!codeEl || !lineNumbersEl) return;

            const htmlLines = alignLineCount(splitHtmlIntoLines(rawHtml), expectedLineCount);
            const sourceLines = parseSourceLines(sourceText, expectedLineCount);
            const normalizedLineOrigins = normalizeSourceLineOrigins(sourceLineOrigins, expectedLineCount);
            prepareFoldState(sourceLines);

            let codeHtml = '';
            let lineNumHtml = '';

            sourceLines.forEach((rawLine, index) => {
                const highlightedLine = htmlLines[index] || '';
                const originalLine = normalizedLineOrigins[index] ?? index;
                const displayLine = highlightedLine.trim() === '' ? '&nbsp;' : highlightedLine;
                const foldState = resolveFoldState(index);
                const hiddenByFold = isLineHiddenByFold(index);
                const styleAttr = hiddenByFold ? ' style="display:none;"' : '';
                const classes = ['code-line'];
                if (isOrderedListLine(rawLine)) {
                    classes.push('ordered-list-line');
                }
                const summaryHtml = foldRangeByStart.has(index)
                  ? '<span class="code-line-content">' + displayLine + '</span>'
                    + '<span class="folded-summary" title="Collapsed region">'
                    + '<span class="folded-summary-text">' + displayLine + '</span>'
                    + '<span class="fold-ellipsis" role="button" tabindex="0" data-fold-open="' + index + '" title="Expand folded region" aria-label="Expand folded region">⋯</span>'
                    + '</span>'
                  : '<span class="code-line-content">' + displayLine + '</span>';

                codeHtml += '<div class="' + classes.join(' ') + '" data-line="' + originalLine + '" data-source-index="' + index + '" data-fold-state="' + foldState + '"' + styleAttr + '>'
                  + summaryHtml
                  + '</div>';
                lineNumHtml += '<div class="line-number" data-line="' + originalLine + '" data-source-index="' + index + '" data-fold-state="' + foldState + '"' + styleAttr + '>'
                  + '<span class="line-number-value">' + (index + 1) + '</span>'
                  + '<span class="line-number-fold-slot">' + buildFoldToggleHtml(index) + '</span>'
                  + '</div>';
            });

            codeEl.innerHTML = codeHtml;
            lineNumbersEl.innerHTML = lineNumHtml;
            bindFoldRailHoverState();
            bindFoldToggleEvents();
            syncLineHeights();
            renderSourceStickyHeadings(true);
        }
`;

export const WEBVIEW_SCRIPT_SYNC = `
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

        function collectSourceHeadings() {
            const parsedHeadings = latestSourceLines.map((rawLine, index) => parseSourceHeading(rawLine, index)).filter(Boolean);
            const lastDocumentLine = getLastStickyContentLine();

            sourceHeadings = parsedHeadings.map((heading, index) => {
                let endLine = lastDocumentLine;
                for (let nextIndex = index + 1; nextIndex < parsedHeadings.length; nextIndex++) {
                    const nextHeading = parsedHeadings[nextIndex];
                    if (nextHeading.level <= heading.level) {
                        endLine = nextHeading.line - 1;
                        break;
                    }
                }

                return {
                    ...heading,
                    endLine: Math.max(heading.line, endLine),
                };
            });
        }

        function getLastStickyContentLine() {
            const lastLine = Math.max(0, latestSourceLines.length - 1);
            if (lastLine > 0 && (latestSourceLines[lastLine] || '') === '') {
                return lastLine - 1;
            }
            return lastLine;
        }


        function renderSourceStickyHeadings(force) {
            const { sticky, content } = getSourceStickyParts();
            if (!sticky || !content) return;

            if (!isSourceModeActive()) {
                sticky.classList.add('is-empty');
                content.innerHTML = '';
                sticky.style.transform = '';
                sticky.style.height = '';
                sourceStickySignature = '';
                return;
            }

            const sourceContainer = document.getElementById('source-container');
            const scrollTop = sourceContainer?.scrollTop || 0;
            const stickyState = findSourceStickyWidgetState(scrollTop);
            const visibleHeadings = stickyState.headings;
            const signature = visibleHeadings.map((heading) => heading.level + ':' + heading.line + ':' + heading.text).join('|') + ':' + stickyState.lastLineRelativePosition;
            if (visibleHeadings.length === 0) {
                sticky.classList.add('is-empty');
                content.innerHTML = '';
                sticky.style.transform = '';
                sticky.style.height = '';
                sourceStickySignature = signature;
                return;
            }

            if (!force && signature === sourceStickySignature) {
                applySourceStickyState(sticky, content, stickyState.lastLineRelativePosition);
                return;
            }

            sourceStickySignature = signature;

            const nextContentHtml = visibleHeadings.map((heading) => {
                const lineEl = findSourceLineBySourceIndex(heading.line);
                if (!lineEl) return '';
                const stickyLineNumber = heading.line + 1;
                const stickyCodeHtml = lineEl.innerHTML;
                const titleText = heading.text.replace(/"/g, '&quot;');
                return '<button class="mt-source-sticky-line" type="button" data-source-index="' + heading.line + '" title="' + titleText + '">'
                    + '<span class="mt-source-sticky-line-number">' + stickyLineNumber + '</span>'
                    + '<span class="mt-source-sticky-line-code">' + stickyCodeHtml + '</span>'
                    + '</button>';
            }).join('');

            sticky.classList.remove('is-empty');
            content.innerHTML = nextContentHtml;
            applySourceStickyState(sticky, content, stickyState.lastLineRelativePosition);
        }

        function buildSourceStickyCandidates() {
            const candidates = [];
            const headingStack = [];

            for (const heading of sourceHeadings) {
                const lineEl = findSourceLineBySourceIndex(heading.line);
                if (!lineEl) continue;

                while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= heading.level) {
                    headingStack.pop();
                }

                const top = headingStack.reduce((sum, ancestor) => {
                    const ancestorEl = findSourceLineBySourceIndex(ancestor.line);
                    return sum + (ancestorEl ? getSourceModelLineHeight(ancestorEl) : 0);
                }, 0);

                candidates.push({
                    heading,
                    top,
                    height: getSourceModelLineHeight(lineEl),
                });
                headingStack.push(heading);
            }

            return candidates;
        }

        function findSourceStickyWidgetState(scrollTop) {
            const candidates = buildSourceStickyCandidates();
            const headings = [];
            let lastLineRelativePosition = 0;

            for (const candidate of candidates) {
                const heading = candidate.heading;
                const startLineEl = findSourceLineBySourceIndex(heading.line);
                const endLineEl = findSourceLineBySourceIndex(heading.endLine);
                if (!startLineEl || !endLineEl) continue;

                const topOfElement = candidate.top;
                const bottomOfElement = topOfElement + candidate.height;
                const topOfBeginningLine = startLineEl.offsetTop - scrollTop;
                const bottomOfEndLine = getSourceModelLineBottom(endLineEl) - scrollTop;

                if (topOfElement > topOfBeginningLine && topOfElement <= bottomOfEndLine) {
                    headings.push(heading);
                    if (bottomOfElement > bottomOfEndLine) {
                        lastLineRelativePosition = bottomOfEndLine - bottomOfElement;
                    } else {
                        lastLineRelativePosition = 0;
                    }
                }
            }

            return { headings, lastLineRelativePosition };
        }

        function getSourceModelLineHeight(lineEl) {
            const lineHeight = parseFloat(getComputedStyle(lineEl).lineHeight);
            if (Number.isFinite(lineHeight) && lineHeight > 0) {
                return lineHeight;
            }
            const rootLineHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mt-source-line-height'));
            if (Number.isFinite(rootLineHeight) && rootLineHeight > 0) {
                return rootLineHeight;
            }
            return Math.max(1, lineEl.offsetHeight || 1);
        }

        function getSourceModelLineBottom(lineEl) {
            return lineEl.offsetTop + getSourceModelLineHeight(lineEl);
        }

        function applySourceStickyState(sticky, content, lastLineRelativePosition) {
            if (!sticky || !content) return;
            resetSourceStickyLineState(content);
            applySourceStickyLastLinePosition(content, lastLineRelativePosition);
            applySourceStickyHeight(sticky, content, lastLineRelativePosition);
        }

        function applySourceStickyHeight(sticky, content, lastLineRelativePosition) {
            if (!sticky || !content) return;
            const contentHeight = content.scrollHeight;
            if (!Number.isFinite(contentHeight) || contentHeight <= 0) {
                sticky.style.height = '';
                return;
            }

            const nextHeight = Math.max(0, contentHeight + Math.min(0, lastLineRelativePosition || 0));
            sticky.style.height = nextHeight > 0 ? (nextHeight + 'px') : '';
        }

        function applySourceStickyLastLinePosition(content, lastLineRelativePosition) {
            const stickyLines = Array.from(content.querySelectorAll('.mt-source-sticky-line'));
            if (stickyLines.length === 0) return;

            const lastLine = stickyLines[stickyLines.length - 1];
            const offset = Math.min(0, lastLineRelativePosition || 0);
            lastLine.style.transform = offset < 0 ? 'translateY(' + offset + 'px)' : '';
        }

        function resetSourceStickyLineState(content) {
            const stickyLines = Array.from(content.querySelectorAll('.mt-source-sticky-line'));
            const total = stickyLines.length;
            for (let index = 0; index < stickyLines.length; index++) {
                const line = stickyLines[index];
                line.style.transform = '';
                line.style.opacity = '';
                line.style.zIndex = String(total - index);
            }
        }


        function bindSourceStickyEvents() {
            const { sticky } = getSourceStickyParts();
            if (!sticky || sticky.dataset.mtBound === '1') return;
            sticky.dataset.mtBound = '1';

            sticky.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                const button = target.closest('.mt-source-sticky-line[data-source-index]');
                if (!button) return;
                const sourceIndex = parseInt(button.getAttribute('data-source-index') || '-1', 10);
                if (!Number.isFinite(sourceIndex) || sourceIndex < 0) return;
                scrollToSourceIndex(sourceIndex);
            });
        }

        function findElementByLine(line) {
            const elements = Array.from(document.querySelectorAll('#preview-container [data-line]'));
            if (elements.length === 0) return null;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                const elLine = parseInt(el.getAttribute('data-line'), 10);
                if (elLine === line) return el;
                const diff = line - elLine;
                if (diff >= 0 && diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest || elements[0];
        }

        function findSourceLineByOriginalLine(line) {
            const elements = Array.from(document.querySelectorAll('#source-code .code-line[data-line]'));
            if (elements.length === 0) return null;
            let closest = null;
            let closestDiff = Infinity;
            let nextClosest = null;
            let nextClosestDiff = Infinity;
            for (const el of elements) {
                if (el.style.display === 'none') continue;
                const elLine = parseInt(el.getAttribute('data-line'), 10);
                if (!Number.isFinite(elLine)) continue;
                if (elLine === line) return el;
                const diff = line - elLine;
                if (diff >= 0 && diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
                if (diff < 0 && Math.abs(diff) < nextClosestDiff) {
                    nextClosestDiff = Math.abs(diff);
                    nextClosest = el;
                }
            }
            return closest || nextClosest || elements.find(el => el.style.display !== 'none') || null;
        }

        function findSourceLineBySourceIndex(sourceIndex) {
            const elements = Array.from(document.querySelectorAll('#source-code .code-line[data-source-index]'));
            if (elements.length === 0) return null;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                if (el.style.display === 'none') continue;
                const elIndex = parseInt(el.getAttribute('data-source-index'), 10);
                if (!Number.isFinite(elIndex)) continue;
                if (elIndex === sourceIndex) return el;
                const diff = sourceIndex - elIndex;
                if (diff >= 0 && diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest || elements.find(el => el.style.display !== 'none') || null;
        }

        function findElementAtViewportTop() {
            const elements = Array.from(document.querySelectorAll('#preview-container [data-line]'));
            if (elements.length === 0) return null;
            const viewportTop = window.scrollY || document.documentElement.scrollTop;
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                const diff = Math.abs(el.offsetTop - viewportTop);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest;
        }

        function findSourceLineAtTop() {
            const sourceContainer = document.getElementById('source-container');
            if (!sourceContainer) return null;
            const elements = Array.from(document.querySelectorAll('#source-code .code-line[data-line]'));
            if (elements.length === 0) return null;
            const viewportTop = sourceContainer.scrollTop;
            let firstVisible = null;
            let candidate = null;
            for (const el of elements) {
                if (el.style.display === 'none') continue;
                if (!firstVisible) {
                    firstVisible = el;
                }
                if (el.offsetTop <= (viewportTop + 1)) {
                    candidate = el;
                    continue;
                }
                break;
            }
            return candidate || firstVisible;
        }


        function setLastInteractedLine(line) {
            if (!Number.isFinite(line) || line < 0) return;
            lastInteractedLine = Math.floor(line);
        }

        function findSourceIndexFromNode(node) {
            if (!node) return null;
            const element = node.nodeType === 1 ? node : node.parentElement;
            if (!element || !element.closest) return null;

            const lineHost = element.closest('#source-code .code-line[data-source-index], #line-numbers .line-number[data-source-index], .mt-source-sticky-line[data-source-index]');
            if (!lineHost) return null;

            const sourceIndex = parseInt(lineHost.getAttribute('data-source-index') || '-1', 10);
            return Number.isFinite(sourceIndex) && sourceIndex >= 0 ? sourceIndex : null;
        }

        function findLineFromNode(node) {
            if (!node) return null;
            const element = node.nodeType === 1 ? node : node.parentElement;
            if (!element || !element.closest) return null;

            const lineHost = element.closest('#preview-container [data-line]');
            if (!lineHost) return null;

            const line = parseInt(lineHost.getAttribute('data-line') || '-1', 10);
            return Number.isFinite(line) && line >= 0 ? line : null;
        }

        function updateLastInteractedLineFromEvent(event) {
            const line = findSourceIndexFromNode(event.target) ?? findLineFromNode(event.target);
            if (line === null) return;
            setLastInteractedLine(line);
        }

        function updateLastInteractedLineFromSelection() {
            const selection = window.getSelection();
            if (!selection) return;
            const line = findSourceIndexFromNode(selection.anchorNode)
                ?? findSourceIndexFromNode(selection.focusNode)
                ?? findLineFromNode(selection.anchorNode)
                ?? findLineFromNode(selection.focusNode);
            if (line === null) return;
            setLastInteractedLine(line);
        }

        function getCurrentSelectionText() {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return null;
            const range = selection.getRangeAt(0);
            if (range.collapsed) return null;
            return selection.toString();
        }

        function getPreviewLineText(line) {
            const element = findElementByLine(line);
            if (!element) return '';
            return (element.innerText || element.textContent || '').replace(/\\r/g, '');
        }

        function normalizeLineForSource(line) {
            if (latestSourceLines.length === 0) return 0;
            if (!Number.isFinite(line) || line < 0) return 0;
            const index = Math.floor(line);
            return Math.min(index, latestSourceLines.length - 1);
        }

        function resolveFallbackLine() {
            if (isSourceModeActive()) {
                const sourceTop = findSourceLineAtTop();
                if (sourceTop) {
                    const line = parseInt(sourceTop.getAttribute('data-source-index') || '-1', 10);
                    if (Number.isFinite(line) && line >= 0) return line;
                }
                return 0;
            }

            const previewTop = findElementAtViewportTop();
            if (previewTop) {
                const line = parseInt(previewTop.getAttribute('data-line') || '-1', 10);
                if (Number.isFinite(line) && line >= 0) return line;
            }
            return 0;
        }

        function resolveCopyTextWithoutSelection() {
            const fallbackLine = resolveFallbackLine();
            const requestedLine = Number.isFinite(lastInteractedLine) ? lastInteractedLine : fallbackLine;
            const targetLine = requestedLine >= 0 ? requestedLine : fallbackLine;
            setLastInteractedLine(targetLine);

            if (isSourceModeActive()) {
                return latestSourceLines[normalizeLineForSource(targetLine)] || '';
            }

            return getPreviewLineText(targetLine);
        }

        function handleCopyEvent(event) {
            updateLastInteractedLineFromSelection();

            const selectedText = getCurrentSelectionText();
            if (selectedText !== null) {
                if (event.clipboardData) {
                    event.preventDefault();
                    event.clipboardData.setData('text/plain', selectedText);
                }
                return;
            }

            const textToCopy = resolveCopyTextWithoutSelection();
            if (!event.clipboardData) return;
            event.preventDefault();
            event.clipboardData.setData('text/plain', textToCopy);
        }

        function isSourceModeActive() {
            return document.body.classList.contains('mt-source-mode');
        }

        function scrollToLine(line) {
            if (isSourceModeActive()) {
                const sourceContainer = document.getElementById('source-container');
                const sourceLine = findSourceLineByOriginalLine(line);
                if (!sourceContainer || !sourceLine) return;
                isSyncingScroll = true;
                sourceContainer.scrollTop = sourceLine.offsetTop;
                updateSourceScrollbar();
                renderSourceStickyHeadings(true);
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
                return;
            }

            const previewElement = findElementByLine(line);
            if (!previewElement) return;
            isSyncingScroll = true;
            const nextScrollTop = Math.max(0, previewElement.getBoundingClientRect().top + window.scrollY);
            window.scrollTo({ top: nextScrollTop, behavior: 'auto' });
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
        }

        function scrollToSourceIndex(sourceIndex) {
            const sourceContainer = document.getElementById('source-container');
            const sourceLine = findSourceLineBySourceIndex(sourceIndex);
            if (!sourceContainer || !sourceLine) return;
            isSyncingScroll = true;
            sourceContainer.scrollTop = sourceLine.offsetTop;
            updateSourceScrollbar();
            renderSourceStickyHeadings(true);
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
        }
`;
