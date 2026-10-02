import { BB_DESKTOP_MAX_FIND_TEXT_LENGTH } from "@bb/desktop-contract";

export const FIND_BAR_VIEW_WIDTH = 344;
export const FIND_BAR_VIEW_HEIGHT = 48;
export const FIND_BAR_VIEW_INSET = 8;

const CHEVRON_UP_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14.5 12 8l7 6.5"/></svg>';
const CHEVRON_DOWN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5 12 16l7-6.5"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function renderFindBarView(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"
  />
  <title>Find in window</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      background: transparent;
      color: CanvasText;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu,
        sans-serif;
      font-size: 13px;
      margin: 0;
      overflow: hidden;
      user-select: none;
    }

    .bar {
      align-items: center;
      background: Canvas;
      border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
      border-radius: 10px;
      box-shadow: 0 8px 24px color-mix(in srgb, CanvasText 22%, transparent);
      display: flex;
      gap: 2px;
      height: ${FIND_BAR_VIEW_HEIGHT - FIND_BAR_VIEW_INSET * 2}px;
      margin: ${FIND_BAR_VIEW_INSET}px;
      padding: 0 4px 0 8px;
    }

    .field {
      align-items: center;
      display: flex;
      flex: 1 1 auto;
      gap: 6px;
      min-width: 0;
    }

    input {
      background: transparent;
      border: 0;
      color: inherit;
      flex: 1 1 auto;
      font: inherit;
      min-width: 0;
      outline: none;
      user-select: text;
    }

    input::placeholder {
      color: color-mix(in srgb, CanvasText 45%, transparent);
    }

    .count {
      color: color-mix(in srgb, CanvasText 55%, transparent);
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
    }

    .count[data-empty="true"] {
      color: color-mix(in srgb, #f04438 80%, CanvasText);
    }

    button {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 6px;
      color: color-mix(in srgb, CanvasText 70%, transparent);
      cursor: default;
      display: flex;
      flex: 0 0 auto;
      height: 24px;
      justify-content: center;
      padding: 0;
      width: 24px;
    }

    button:hover:not(:disabled) {
      background: color-mix(in srgb, CanvasText 10%, transparent);
      color: CanvasText;
    }

    button:disabled {
      opacity: 0.35;
    }

    svg {
      fill: none;
      height: 16px;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.75;
      width: 16px;
    }
  </style>
</head>
<body>
  <div class="bar" role="search" aria-label="Find in window">
    <div class="field">
      <input
        id="bb-find-input"
        type="text"
        placeholder="Find in window"
        aria-label="Find in window"
        autocomplete="off"
        spellcheck="false"
        maxlength="${BB_DESKTOP_MAX_FIND_TEXT_LENGTH}"
      />
      <span id="bb-find-count" class="count" role="status" aria-live="polite"></span>
    </div>
    <button type="button" data-step="previous" aria-label="Previous match" disabled>
      ${CHEVRON_UP_ICON}
    </button>
    <button type="button" data-step="next" aria-label="Next match" disabled>
      ${CHEVRON_DOWN_ICON}
    </button>
    <button type="button" data-action="close" aria-label="Close find bar">
      ${CLOSE_ICON}
    </button>
  </div>
</body>
</html>`;
}

export function createFindBarViewUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    renderFindBarView(),
  )}`;
}
