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

        function applySourceTokenThemeVars(themeVars) {
            const sourceContainerEl = document.getElementById('source-container');
            if (!sourceContainerEl || !themeVars || typeof themeVars !== 'object') return;
            for (const key of Object.keys(themeVars)) {
                const value = themeVars[key];
                if (typeof value === 'string' && value.length > 0) {
                    sourceContainerEl.style.setProperty(key, value);
                }
            }
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
                const thumbRect = thumb.getBoundingClientRect();
                dragging = true;
                dragPointerOffset = event.clientY - thumbRect.top;
                document.body.classList.add('mt-scrollbar-dragging');
            });

            track.addEventListener('mousedown', (event) => {
                if (event.target === thumb) return;
                event.preventDefault();
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
                const lineNumber = parseInt(lineEl.getAttribute('data-line') || '-1', 10);
                const hidden = isLineHiddenByFold(lineNumber);
                lineEl.style.display = hidden ? 'none' : '';

                const foldState = resolveFoldState(lineNumber);
                lineEl.dataset.foldState = foldState;
            }

            for (const numEl of lineNumbers) {
                const lineNumber = parseInt(numEl.getAttribute('data-line') || '-1', 10);
                const hidden = isLineHiddenByFold(lineNumber);
                numEl.style.display = hidden ? 'none' : '';
                const foldState = resolveFoldState(lineNumber);
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

        function renderSourceCode(rawHtml, sourceText, expectedLineCount) {
            const codeEl = document.getElementById('source-code');
            const lineNumbersEl = document.getElementById('line-numbers');
            if (!codeEl || !lineNumbersEl) return;

            const htmlLines = alignLineCount(splitHtmlIntoLines(rawHtml), expectedLineCount);
            const sourceLines = parseSourceLines(sourceText, expectedLineCount);
            prepareFoldState(sourceLines);

            let codeHtml = '';
            let lineNumHtml = '';

            sourceLines.forEach((rawLine, index) => {
                const highlightedLine = htmlLines[index] || '';
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

                codeHtml += '<div class="' + classes.join(' ') + '" data-line="' + index + '" data-fold-state="' + foldState + '"' + styleAttr + '>'
                  + summaryHtml
                  + '</div>';
                lineNumHtml += '<div class="line-number" data-line="' + index + '" data-fold-state="' + foldState + '"' + styleAttr + '>'
                  + '<span class="line-number-value">' + (index + 1) + '</span>'
                  + '<span class="line-number-fold-slot">' + buildFoldToggleHtml(index) + '</span>'
                  + '</div>';
            });

            codeEl.innerHTML = codeHtml;
            lineNumbersEl.innerHTML = lineNumHtml;
            bindFoldRailHoverState();
            bindFoldToggleEvents();
            syncLineHeights();
        }
`;

export const WEBVIEW_SCRIPT_SYNC = `
        let latestSourceLines = parseSourceLines(initialSourceText, initialSourceLineCount);
        let lastInteractedLine = 0;

        try {
            applyViewModeLayout(initialViewMode);
            applySourceEditorMetrics(initialSourceLineHeight);
            applyResolvedFoldBackground();
            applySourceTokenThemeVars(initialSourceTokenThemeVars);
            bindSourceScrollbar();
            const sourceCodeEl = document.getElementById('source-code');
            if (sourceCodeEl) {
                const initialRawHtml = sourceCodeEl.innerHTML;
                renderSourceCode(initialRawHtml, initialSourceText, initialSourceLineCount);
            }
        } catch (e) {
            console.error('Error in initial source code render:', e);
        }

        window.addEventListener('resize', () => {
            syncLineHeights();
            updateSourceScrollbar();
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                document.getElementById('preview-container').innerHTML = message.html;
                latestSourceLines = parseSourceLines(message.sourceText, message.sourceLineCount);
                applySourceEditorMetrics(message.sourceLineHeight);
                applyResolvedFoldBackground();
                applySourceTokenThemeVars(message.sourceTokenThemeVars);
                setSourceHighlightError(message.sourceHighlightError);
                const codeEl = document.getElementById('source-code');
                if (codeEl) {
                    renderSourceCode(message.sourceHtml, message.sourceText, message.sourceLineCount);
                }
            } else if (message.type === 'setViewMode') {
                const previewEl = document.getElementById('preview-container');
                const sourceEl = document.getElementById('source-container');
                applyViewModeLayout(message.mode);
                if (message.mode === 'source') {
                    previewEl.style.display = 'none';
                    sourceEl.style.display = 'flex';
                    setTimeout(() => {
                        syncLineHeights();
                        updateSourceScrollbar();
                    }, 0);
                } else {
                    previewEl.style.display = 'block';
                    sourceEl.style.display = 'none';
                }
            } else if (message.type === 'scroll') {
                const line = message.line;
                scrollToLine(line);
            }
        });

        window.addEventListener('scroll', () => {
            if (isSyncingScroll) return;
            const previewEl = document.getElementById('preview-container');
            if (previewEl && previewEl.style.display !== 'none') {
                const element = findElementAtViewportTop();
                if (element) {
                    const line = parseInt(element.getAttribute('data-line'), 10);
                    vscode.postMessage({ command: 'scroll', line: line });
                }
            }
        });

        const sourceContainerEl = document.getElementById('source-container');
        if (sourceContainerEl) {
            sourceContainerEl.addEventListener('scroll', () => {
                updateSourceScrollbar();
                if (isSyncingScroll) return;
                if (!isSourceModeActive()) return;
                const lineEl = findSourceLineAtTop();
                if (!lineEl) return;
                const line = parseInt(lineEl.getAttribute('data-line'), 10);
                if (Number.isFinite(line)) {
                    vscode.postMessage({ command: 'scroll', line });
                }
            });
        }

        const previewContainerEl = document.getElementById('preview-container');
        if (previewContainerEl) {
            previewContainerEl.addEventListener('mousedown', updateLastInteractedLineFromEvent, true);
        }

        if (sourceContainerEl) {
            sourceContainerEl.addEventListener('mousedown', updateLastInteractedLineFromEvent, true);
        }

        document.addEventListener('selectionchange', updateLastInteractedLineFromSelection, true);
        document.addEventListener('copy', handleCopyEvent, true);

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

        function findSourceLineByLine(line) {
            const elements = Array.from(document.querySelectorAll('#source-code .code-line[data-line]'));
            if (elements.length === 0) return null;
            let closest = null;
            let closestDiff = Infinity;
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
            let closest = null;
            let closestDiff = Infinity;
            for (const el of elements) {
                if (el.style.display === 'none') continue;
                const diff = Math.abs(el.offsetTop - viewportTop);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = el;
                }
            }
            return closest;
        }

        function setLastInteractedLine(line) {
            if (!Number.isFinite(line) || line < 0) return;
            lastInteractedLine = Math.floor(line);
        }

        function findLineFromNode(node) {
            if (!node) return null;
            const element = node.nodeType === 1 ? node : node.parentElement;
            if (!element || !element.closest) return null;

            const lineHost = element.closest('#source-code .code-line[data-line], #line-numbers .line-number[data-line], #preview-container [data-line]');
            if (!lineHost) return null;

            const line = parseInt(lineHost.getAttribute('data-line') || '-1', 10);
            return Number.isFinite(line) && line >= 0 ? line : null;
        }

        function updateLastInteractedLineFromEvent(event) {
            const line = findLineFromNode(event.target);
            if (line === null) return;
            setLastInteractedLine(line);
        }

        function updateLastInteractedLineFromSelection() {
            const selection = window.getSelection();
            if (!selection) return;
            const line = findLineFromNode(selection.anchorNode) ?? findLineFromNode(selection.focusNode);
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
                    const line = parseInt(sourceTop.getAttribute('data-line') || '-1', 10);
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
                const sourceLine = findSourceLineByLine(line);
                if (!sourceContainer || !sourceLine) return;
                isSyncingScroll = true;
                sourceContainer.scrollTop = sourceLine.offsetTop;
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
                return;
            }

            const previewElement = findElementByLine(line);
            if (!previewElement) return;
            isSyncingScroll = true;
            previewElement.scrollIntoView({ behavior: 'auto', block: 'start' });
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => { isSyncingScroll = false; }, 150);
        }
`;
