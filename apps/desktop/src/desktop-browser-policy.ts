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
 * the renderer can open it as a new in-panel browser tab.
 */
export function resolveWindowOpenAction(url: string): WindowOpenDecision {
  return { openTabUrl: isAllowedBrowserUrl(url) ? url : null };
}

// --- Local / LAN request firewall ---
//
// The in-app browser is meant to test local sites, so localhost / loopback
// hosts are allowed. Private LAN and mDNS hosts remain blocked at the network
// layer (see the `session.webRequest` wiring in desktop-browser-view).
//
// Residual: this classifies the URL host, not the DNS-resolved address, so a
// public name that resolves to a private IP (DNS rebinding) is not caught here.
// That is a deeper, separate mitigation and out of scope for v1.

const NETWORK_REQUEST_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

function parseIpv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) {
    return null;
  }
  const octets = [match[1], match[2], match[3], match[4]].map((part) =>
    Number(part),
  );
  return octets.some((octet) => octet > 255) ? null : octets;
}

function normalizeRequestHost(rawHost: string): string | null {
  let host = rawHost.trim().toLowerCase();
  if (host.length === 0) {
    return null;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const zoneIndex = host.indexOf("%");
  if (zoneIndex !== -1) {
    host = host.slice(0, zoneIndex);
  }
  return host;
}

function isLocalIpv4(octets: readonly number[]): boolean {
  const [a] = octets;
  return a === 0 || a === 127;
}

function isBlockedIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (isLocalIpv4(octets)) return true; // 0.0.0.0/8, 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

function expandIpv6(host: string): number[] | null {
  let work = host;
  // Fold a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  const dotIndex = work.indexOf(".");
  if (dotIndex !== -1) {
    const lastColon = work.lastIndexOf(":", dotIndex);
    if (lastColon === -1) {
      return null;
    }
    const v4 = parseIpv4Octets(work.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    work = `${work.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const sides = work.split("::");
  if (sides.length > 2) {
    return null;
  }
  const toGroups = (part: string): string[] =>
    part.length === 0 ? [] : part.split(":");
  const head = toGroups(sides[0]);
  let groups: string[];
  if (sides.length === 2) {
    const tail = toGroups(sides[1]);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) {
      return null;
    }
    groups = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) {
    return null;
  }
  const hextets: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    hextets.push(parseInt(group, 16));
  }
  return hextets;
}

function ipv4TailFromIpv6(hextets: readonly number[]): number[] | null {
  const firstFiveZero = hextets.slice(0, 5).every((value) => value === 0);
  if (!firstFiveZero || (hextets[5] !== 0xffff && hextets[5] !== 0)) {
    return null;
  }
  return [
    hextets[6] >> 8,
    hextets[6] & 0xff,
    hextets[7] >> 8,
    hextets[7] & 0xff,
  ];
}

function isLocalIpv6(hextets: readonly number[]): boolean {
  const leadingZeros = hextets.slice(0, 7).every((value) => value === 0);
  if (leadingZeros && hextets[7] === 1) return true; // ::1 loopback
  if (hextets.every((value) => value === 0)) return true; // :: unspecified
  const ipv4Tail = ipv4TailFromIpv6(hextets);
  return ipv4Tail !== null && isLocalIpv4(ipv4Tail);
}

function isLocalIpv6Literal(host: string): boolean {
  const hextets = expandIpv6(host);
  return hextets !== null && isLocalIpv6(hextets);
}

function isBlockedIpv6Literal(host: string): boolean {
  const hextets = expandIpv6(host);
  if (hextets === null) {
    return true; // unparseable IPv6 literal → block to be safe
  }
  if (isLocalIpv6(hextets)) return true;
  if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
  const ipv4Tail = ipv4TailFromIpv6(hextets);
  if (ipv4Tail !== null) {
    return isBlockedIpv4(ipv4Tail);
  }
  return false;
}

/**
 * Whether a request host names the user's own machine. The in-app browser is
 * intended for local testing, so these hosts are not blocked by the request
 * firewall.
 */
export function isLocalBrowserRequestHost(rawHost: string): boolean {
  const host = normalizeRequestHost(rawHost);
  if (host === null) {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  const ipv4 = parseIpv4Octets(host);
  if (ipv4 !== null) {
    return isLocalIpv4(ipv4);
  }
  if (host.includes(":")) {
    return isLocalIpv6Literal(host);
  }
  return false;
}

/**
 * Whether a request host (URL hostname, no port) must be blocked because it
 * targets link-local, private/LAN, or mDNS `.local` space. Localhost,
 * loopback, public names, and public addresses return false. Exported for unit
 * testing.
 */
export function isBlockedBrowserRequestHost(rawHost: string): boolean {
  const host = normalizeRequestHost(rawHost);
  if (host === null) {
    return true;
  }
  if (isLocalBrowserRequestHost(host)) {
    return false;
  }
  if (host === "local" || host.endsWith(".local")) {
    return true;
  }
  const ipv4 = parseIpv4Octets(host);
  if (ipv4 !== null) {
    return isBlockedIpv4(ipv4);
  }
  if (host.includes(":")) {
    return isBlockedIpv6Literal(host);
  }
  return false;
}

/**
 * Whether a network request URL must be blocked. Only `http(s)`/`ws(s)` carry a
 * remote host worth guarding; `data:`/`blob:`/`about:` have none and are
 * allowed (`webSecurity` guards `file:`). Exported for unit testing.
 */
export function isBlockedBrowserRequestUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!NETWORK_REQUEST_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }
  return isBlockedBrowserRequestHost(parsed.hostname);
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
