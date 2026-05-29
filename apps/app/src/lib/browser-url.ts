// Address-bar / new-tab search input parsing for the browser surface. Pure and
// dependency-free so the URL-vs-search heuristic can be unit tested directly.

const SEARCH_ENGINE_URL = "https://www.google.com/search";
const HTTP_SCHEME_PATTERN = /^https?:\/\//i;
const LOCALHOST_PATTERN = /^localhost(:\d+)?(\/|$)/i;
// host.tld (one or more dotted labels), optional port, optional path/query.
const HOSTNAME_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;

/**
 * Whether the trimmed input should be treated as a URL to navigate to (vs. a
 * search query). Only an explicit `http(s)://` scheme or a bare `host.tld` /
 * `localhost` shape counts — anything with whitespace, or a non-http scheme
 * such as `file:`/`javascript:`/`data:`, is treated as a search.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0 || /\s/u.test(trimmed)) {
    return false;
  }
  if (HTTP_SCHEME_PATTERN.test(trimmed)) {
    return true;
  }
  return LOCALHOST_PATTERN.test(trimmed) || HOSTNAME_PATTERN.test(trimmed);
}

function buildSearchUrl(query: string): string {
  return `${SEARCH_ENGINE_URL}?q=${encodeURIComponent(query)}`;
}

function normalizeUrl(input: string): string {
  return HTTP_SCHEME_PATTERN.test(input) ? input : `https://${input}`;
}

/**
 * Resolve an address-bar input to a navigable `http(s)` URL, or a default
 * search-engine query URL when it does not look like a URL. Returns `null` for
 * blank input (nothing to navigate to).
 */
export function resolveBrowserAddressInput(rawInput: string): string | null {
  const input = rawInput.trim();
  if (input.length === 0) {
    return null;
  }
  return looksLikeUrl(input) ? normalizeUrl(input) : buildSearchUrl(input);
}

/** Security posture of a loaded URL, for the address-bar indicator. */
export type BrowserUrlSecurity = "secure" | "insecure" | "none";

export function getBrowserUrlSecurity(url: string): BrowserUrlSecurity {
  if (url.length === 0) {
    return "none";
  }
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "https:") {
      return "secure";
    }
    if (protocol === "http:") {
      return "insecure";
    }
  } catch {
    return "none";
  }
  return "none";
}

/** A compact label for a URL — the hostname when parseable, else the raw URL. */
export function getBrowserUrlHost(url: string): string {
  if (url.length === 0) {
    return "";
  }
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
