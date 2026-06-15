export const WEBVIEW_SCRIPT_NAVIGATION = `
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
            const nextScrollTop = Number(line) <= 0
                ? 0
                : Math.max(0, previewElement.getBoundingClientRect().top + window.scrollY);
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
