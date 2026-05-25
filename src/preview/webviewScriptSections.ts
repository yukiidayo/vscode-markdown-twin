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

                const toggleEl = lineEl.querySelector('.fold-toggle[data-fold-start]');
                if (toggleEl) {
                    const startLine = parseInt(toggleEl.getAttribute('data-fold-start') || '-1', 10);
                    const collapsed = collapsedFoldStarts.has(startLine);
                    toggleEl.classList.toggle('is-collapsed', collapsed);
                    toggleEl.setAttribute('aria-expanded', String(!collapsed));
                    toggleEl.setAttribute('title', collapsed ? 'Expand folded region' : 'Collapse region');
                }

                const isCollapsedStart = foldRangeByStart.has(lineNumber) && collapsedFoldStarts.has(lineNumber);
                lineEl.classList.toggle('fold-collapsed-start', isCollapsedStart);
            }

            for (const numEl of lineNumbers) {
                const lineNumber = parseInt(numEl.getAttribute('data-line') || '-1', 10);
                const hidden = isLineHiddenByFold(lineNumber);
                numEl.style.display = hidden ? 'none' : '';
            }

            syncLineHeights();
        }

        function bindFoldToggleEvents() {
            const toggles = document.querySelectorAll('#source-code .fold-toggle[data-fold-start]');
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
                ellipsis.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startLine = parseInt(ellipsis.getAttribute('data-fold-open') || '-1', 10);
                    if (!Number.isFinite(startLine) || startLine < 0) return;
                    if (!foldRangeByStart.has(startLine) || !collapsedFoldStarts.has(startLine)) return;
                    setFoldCollapsed(startLine, false);
                    applyFoldStateToDom();
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
            if (!codeEl || !lineNumbersEl) return;

            const codeLines = codeEl.querySelectorAll('.code-line');
            const lineNumbers = lineNumbersEl.querySelectorAll('.line-number');

            if (codeLines.length !== lineNumbers.length) return;

            for (let i = 0; i < codeLines.length; i++) {
                const height = codeLines[i].getBoundingClientRect().height;
                lineNumbers[i].style.height = height + 'px';
            }
            updateScrollBeyondLastLinePadding();
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
                const collapsedStart = foldRangeByStart.has(index) && collapsedFoldStarts.has(index);
                const hiddenByFold = isLineHiddenByFold(index);
                const styleAttr = hiddenByFold ? ' style="display:none;"' : '';
                const classes = ['code-line'];
                if (isOrderedListLine(rawLine)) {
                    classes.push('ordered-list-line');
                }
                if (collapsedStart) {
                    classes.push('fold-collapsed-start');
                }
                const summaryHtml = collapsedStart
                  ? '<span class="folded-summary" title="Collapsed region">'
                    + '<span class="code-line-content">' + displayLine + '</span>'
                    + '<button class="fold-ellipsis" type="button" data-fold-open="' + index + '" title="Expand folded region">...</button>'
                    + '</span>'
                  : '<span class="code-line-content">' + displayLine + '</span>';

                codeHtml += '<div class="' + classes.join(' ') + '" data-line="' + index + '"' + styleAttr + '>'
                  + buildFoldToggleHtml(index)
                  + summaryHtml
                  + '</div>';
                lineNumHtml += '<div class="line-number" data-line="' + index + '"' + styleAttr + '>' + (index + 1) + '</div>';
            });

            codeEl.innerHTML = codeHtml;
            lineNumbersEl.innerHTML = lineNumHtml;
            bindFoldToggleEvents();
            syncLineHeights();
        }
`;

export const WEBVIEW_SCRIPT_SYNC = `
        try {
            applyViewModeLayout(initialViewMode);
            applySourceEditorMetrics(initialSourceLineHeight);
            applyResolvedFoldBackground();
            applySourceTokenThemeVars(initialSourceTokenThemeVars);
            const sourceCodeEl = document.getElementById('source-code');
            if (sourceCodeEl) {
                const initialRawHtml = sourceCodeEl.innerHTML;
                renderSourceCode(initialRawHtml, initialSourceText, initialSourceLineCount);
            }
        } catch (e) {
            console.error('Error in initial source code render:', e);
        }

        window.addEventListener('resize', syncLineHeights);

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'update') {
                document.getElementById('preview-container').innerHTML = message.html;
                applySourceEditorMetrics(message.sourceLineHeight);
                applyResolvedFoldBackground();
                applySourceTokenThemeVars(message.sourceTokenThemeVars);
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
                    setTimeout(syncLineHeights, 0);
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
