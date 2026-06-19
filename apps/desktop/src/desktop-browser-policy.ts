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
  return { openTabUrl: isAllowedPublicBrowserPopupUrl(url) ? url : null };
}

// --- Loopback / LAN request firewall ---
//
// Untrusted browsed pages must never be able to reach bb's own loopback
// services (server `/ws`, host-daemon local API) or other hosts on the user's
// LAN. CORS only filters responses; it does not stop the request from being
// sent and acted on. So we block at the network layer (see the
// `session.webRequest` wiring in desktop-browser-view) using these predicates,
// which classify the request's URL host as loopback / link-local / private.
//
// Residual: this classifies the URL host, not the DNS-resolved address, so a
// public name that resolves to a private IP (DNS rebinding) is not caught here.
// That is a deeper, separate mitigation and out of scope for v1.

export interface ShouldBlockBrowserRequestArgs {
  url: string;
  method: string;
  resourceType: string;
  isMainFrame: boolean;
  targetWebContentsId: number | null;
  entryWebContentsId: number | null;
  currentMainFrameLocalOriginKey: string | null;
  requestingFrameOriginKey: string | null;
}

interface ParsedBrowserRequestUrl {
  protocol: string;
  host: string;
  originHost: string;
  port: string;
}

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

function isLoopbackIpv4(octets: readonly number[]): boolean {
  return octets[0] === 127; // 127.0.0.0/8 loopback
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 198 && b === 18) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 19) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
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

function isLoopbackIpv6Literal(host: string): boolean {
  const hextets = expandIpv6(host);
  if (hextets === null) {
    return false;
  }
  const leadingZeros = hextets.slice(0, 7).every((value) => value === 0);
  return leadingZeros && hextets[7] === 1; // ::1 loopback
}

function isPrivateIpv6Literal(host: string): boolean {
  const hextets = expandIpv6(host);
  if (hextets === null) {
    return true; // unparseable IPv6 literal -> block to be safe
  }
  if (hextets.every((value) => value === 0)) return true; // :: unspecified
  if (isLoopbackIpv6Literal(host)) return false; // ::1 is handled as loopback
  if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((hextets[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (hextets[0] === 0x2001 && hextets[1] === 0x0db8) return true; // docs
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
  const firstFiveZero = hextets.slice(0, 5).every((value) => value === 0);
  if (firstFiveZero && (hextets[5] === 0xffff || hextets[5] === 0)) {
    const mappedOctets = [
      hextets[6] >> 8,
      hextets[6] & 0xff,
      hextets[7] >> 8,
      hextets[7] & 0xff,
    ];
    return isLoopbackIpv4(mappedOctets) || isPrivateIpv4(mappedOctets);
  }
  return false;
}

function normalizeBrowserRequestHost(rawHost: string): string | null {
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
  while (host.endsWith(".") && host.length > 1) {
    host = host.slice(0, -1);
  }
  return host.length === 0 ? null : host;
}

function normalizeBrowserOriginHost(rawHost: string): string | null {
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
  return host.length === 0 ? null : host;
}

function isLocalhostName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

function isMdnsName(host: string): boolean {
  return host === "local" || host.endsWith(".local");
}

function parseBrowserRequestUrl(url: string): ParsedBrowserRequestUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = normalizeBrowserRequestHost(parsed.hostname);
  const originHost = normalizeBrowserOriginHost(parsed.hostname);
  if (host === null || originHost === null) {
    return null;
  }
  return { protocol: parsed.protocol, host, originHost, port: parsed.port };
}

function isGuardedRequestProtocol(protocol: string): boolean {
  return (
    protocol === "http:" ||
    protocol === "https:" ||
    protocol === "ws:" ||
    protocol === "wss:"
  );
}

function requestUrlTargetsLoopbackOrPrivate(url: string): boolean {
  const parsed = parseBrowserRequestUrl(url);
  if (parsed === null || !isGuardedRequestProtocol(parsed.protocol)) {
    return false;
  }
  return (
    isLoopbackBrowserRequestHost(parsed.host) ||
    isPrivateBrowserRequestHost(parsed.host)
  );
}

function browserRequestHasEntryAttribution(
  args: ShouldBlockBrowserRequestArgs,
): boolean {
  return (
    args.targetWebContentsId !== null &&
    args.entryWebContentsId !== null &&
    args.targetWebContentsId === args.entryWebContentsId
  );
}

function isReadOnlyMainFrameRequestMethod(method: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  return normalizedMethod === "GET" || normalizedMethod === "HEAD";
}

function localRequestProtocolClass(protocol: string): string | null {
  if (protocol === "http:" || protocol === "ws:") {
    return "local";
  }
  if (protocol === "https:" || protocol === "wss:") {
    return "secure-local";
  }
  return null;
}

function isAllowedPublicBrowserPopupUrl(url: string): boolean {
  const parsed = parseBrowserRequestUrl(url);
  return (
    parsed !== null &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    !isLoopbackBrowserRequestHost(parsed.host) &&
    !isPrivateBrowserRequestHost(parsed.host)
  );
}

/**
 * Whether a request host (URL hostname, no port) is a loopback host. Loopback
 * top-level navigation is allowed, but non-main-frame requests are guarded so
 * browsed pages cannot invisibly reach local services.
 */
export function isLoopbackBrowserRequestHost(rawHost: string): boolean {
  const host = normalizeBrowserRequestHost(rawHost);
  if (host === null) {
    return false;
  }
  if (isLocalhostName(host)) {
    return true;
  }
  const ipv4 = parseIpv4Octets(host);
  if (ipv4 !== null) {
    return isLoopbackIpv4(ipv4);
  }
  return host.includes(":") && isLoopbackIpv6Literal(host);
}

/**
 * Whether a request host targets private/LAN, link-local, mDNS, CGNAT,
 * multicast/reserved, unspecified, or otherwise ambiguous local address space.
 * Loopback hosts are intentionally classified separately.
 */
export function isPrivateBrowserRequestHost(rawHost: string): boolean {
  const host = normalizeBrowserRequestHost(rawHost);
  if (host === null) {
    return true;
  }
  if (isLocalhostName(host)) {
    return false;
  }
  if (isMdnsName(host)) {
    return true;
  }
  const ipv4 = parseIpv4Octets(host);
  if (ipv4 !== null) {
    return !isLoopbackIpv4(ipv4) && isPrivateIpv4(ipv4);
  }
  if (host.includes(":")) {
    return isPrivateIpv6Literal(host);
  }
  return false;
}

/**
 * Whether a request host (URL hostname, no port) must be blocked by the legacy
 * coarse firewall because it targets loopback, private/LAN, or related local
 * address space. Public names and addresses return false.
 */
export function isBlockedBrowserRequestHost(rawHost: string): boolean {
  return (
    isLoopbackBrowserRequestHost(rawHost) ||
    isPrivateBrowserRequestHost(rawHost)
  );
}

/**
 * Returns the comparable local origin key for loopback `http(s)`/`ws(s)` URLs.
 * `http` and `ws` share one transport class; `https` and `wss` share another.
 */
export function localRequestOriginKey(url: string): string | null {
  const parsed = parseBrowserRequestUrl(url);
  if (parsed === null || !isLoopbackBrowserRequestHost(parsed.host)) {
    return null;
  }
  const protocolClass = localRequestProtocolClass(parsed.protocol);
  if (protocolClass === null) {
    return null;
  }
  return `${protocolClass}|${parsed.originHost}|${parsed.port}`;
}

export interface ResolveRequestingFrameLocalOriginKeyArgs {
  /** The requesting frame's reported origin (`details.frame?.origin`). */
  origin: string | undefined;
  /** The requesting frame's committed URL (`details.frame?.url`). */
  url: string | undefined;
  /** Whether the requesting frame is the top frame (`frame.parent === null`). */
  isTopFrame: boolean;
}

/**
 * Resolves the comparable local-origin key for the frame that initiated a
 * request. Prefers the frame's reported `origin`; for a **top** frame whose
 * origin is not yet populated — Electron reports an empty origin for a
 * document's initial subresource requests, before it has run script and
 * committed its origin (which blanks SPA dev servers like Vite) — it falls
 * back to the frame's committed `url`. The URL fallback is restricted to the
 * top frame so a sub-iframe presenting an empty origin can never be mistaken
 * for the trusted main frame.
 */
export function resolveRequestingFrameLocalOriginKey(
  args: ResolveRequestingFrameLocalOriginKeyArgs,
): string | null {
  const fromOrigin =
    args.origin === undefined ? null : localRequestOriginKey(args.origin);
  if (fromOrigin !== null) {
    return fromOrigin;
  }
  if (args.isTopFrame && args.url !== undefined) {
    return localRequestOriginKey(args.url);
  }
  return null;
}

/**
 * Whether a network request URL must be blocked by the current coarse
 * loopback/LAN firewall. Only `http(s)`/`ws(s)` carry a remote host worth
 * guarding; `data:`/`blob:`/`about:` have none and are allowed (`webSecurity`
 * guards `file:`). Exported for unit testing and current native wiring.
 */
export function isBlockedBrowserRequestUrl(url: string): boolean {
  return requestUrlTargetsLoopbackOrPrivate(url);
}

/**
 * Pure same-origin loopback/private request decision. The caller is responsible
 * for resolving Electron's `webContentsId` to exactly one live browser entry
 * before passing the entry id and local-origin state here.
 */
export function shouldBlockBrowserRequest(
  args: ShouldBlockBrowserRequestArgs,
): boolean {
  const isMainFrameRequest =
    args.isMainFrame || args.resourceType === "mainFrame";
  if (isMainFrameRequest) {
    if (!isAllowedBrowserUrl(args.url)) {
      return true;
    }
    const parsed = parseBrowserRequestUrl(args.url);
    if (parsed !== null && isPrivateBrowserRequestHost(parsed.host)) {
      return true;
    }
    if (
      !isReadOnlyMainFrameRequestMethod(args.method) &&
      parsed !== null &&
      isLoopbackBrowserRequestHost(parsed.host)
    ) {
      return true;
    }
    return false;
  }
  const parsed = parseBrowserRequestUrl(args.url);
  if (parsed === null || !isGuardedRequestProtocol(parsed.protocol)) {
    return false;
  }
  if (isPrivateBrowserRequestHost(parsed.host)) {
    return true;
  }
  if (!isLoopbackBrowserRequestHost(parsed.host)) {
    return false;
  }
  if (!browserRequestHasEntryAttribution(args)) {
    return true;
  }
  const targetOriginKey = localRequestOriginKey(args.url);
  if (targetOriginKey === null) {
    return true;
  }
  if (
    args.currentMainFrameLocalOriginKey === null ||
    args.requestingFrameOriginKey === null ||
    args.requestingFrameOriginKey !== args.currentMainFrameLocalOriginKey
  ) {
    return true;
  }
  return targetOriginKey !== args.currentMainFrameLocalOriginKey;
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
