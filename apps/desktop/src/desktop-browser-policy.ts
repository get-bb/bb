// Pure navigation/popup policy for the in-app browser view. Kept free of any
// `electron` import so it can be unit tested under vitest's node environment.

/**
 * Only `http`/`https` top-level navigations are allowed in the browser view.
 * Everything else (`file:`, `javascript:`, custom schemes, `about:` beyond
 * blank) is treated as hostile and blocked.
 */
export function isAllowedBrowserUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export interface WindowOpenDecision {
  /** The URL to open as a new in-panel tab, or null to deny entirely. */
  openTabUrl: string | null;
}

/**
 * Decide what to do with a `window.open`/`target=_blank` request. The native OS
 * popup is always denied by the caller; an allowed http(s) URL is surfaced so
 * the renderer can open it as a new in-panel browser tab. Loopback and LAN
 * popups are allowed like any other http(s) URL: the user browses their own
 * machine deliberately, and a popup is the same act as typing the address.
 */
export function resolveWindowOpenAction(url: string): WindowOpenDecision {
  return { openTabUrl: isAllowedBrowserUrl(url) ? url : null };
}

// --- Popup-tab rate limiting ---

export interface PopupRateDecision {
  allowed: boolean;
  timestamps: number[];
}

export interface EvaluatePopupRateArgs {
  timestamps: readonly number[];
  now: number;
  windowMs: number;
  maxInWindow: number;
}

/**
 * Sliding-window rate gate for popup → in-panel-tab creation, so a hostile page
 * cannot spam tabs. Returns the (pruned) timestamp list the caller should
 * persist, plus whether this popup is allowed. Pure; exported for unit testing.
 */
export function evaluatePopupRate({
  timestamps,
  now,
  windowMs,
  maxInWindow,
}: EvaluatePopupRateArgs): PopupRateDecision {
  const recent = timestamps.filter((stamp) => now - stamp < windowMs);
  if (recent.length >= maxInWindow) {
    return { allowed: false, timestamps: recent };
  }
  return { allowed: true, timestamps: [...recent, now] };
}
