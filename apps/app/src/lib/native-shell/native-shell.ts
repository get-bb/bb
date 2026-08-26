import {
  compareBridgeVersions,
  isBridgeUsable,
  NATIVE_BRIDGE_GLOBAL,
  parseNativeShellHandshake,
  parseShellToPageEvent,
  safeAreaInsetsSchema,
  shareResultSchema,
  type BridgeHapticKind,
  type BridgeSharePayload,
  type NativeScreen,
  type NativeCapability,
  type NativeShellHandshake,
  type SafeAreaInsets,
  type ShellToPageEvent,
} from "@bb/mobile-bridge";

/**
 * The page's half of the shell bridge.
 *
 * The same build runs in a plain browser, in the desktop app, and inside the
 * bb mobile shell, so nothing here may assume the bridge exists. Every export
 * falls back to the web behaviour and says whether the shell took the call.
 */

interface NativeBridgeGlobal {
  post(message: unknown): void;
  request(kind: string, payload: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
  safeArea?: unknown;
}

export interface NativeShell {
  handshake: NativeShellHandshake;
  /** Live insets; the shell replaces them on rotation. */
  safeArea(): SafeAreaInsets;
  has(capability: NativeCapability): boolean;
  post(message: unknown): void;
  request(kind: string, payload: unknown): Promise<unknown>;
  subscribe(listener: (event: ShellToPageEvent) => void): () => void;
}

function readBridgeGlobal(): NativeBridgeGlobal | null {
  if (typeof window === "undefined") return null;
  const root = (window as unknown as Record<string, unknown>)[
    NATIVE_BRIDGE_GLOBAL
  ];
  if (typeof root !== "object" || root === null) return null;
  const native = (root as Record<string, unknown>).native;
  if (typeof native !== "object" || native === null) return null;
  const candidate = native as Partial<NativeBridgeGlobal>;
  if (
    typeof candidate.post !== "function" ||
    typeof candidate.request !== "function" ||
    typeof candidate.subscribe !== "function"
  ) {
    return null;
  }
  return native as NativeBridgeGlobal;
}

/**
 * The global carries the handshake fields alongside its functions, and the
 * schema is strict, so the fields have to be picked out before parsing.
 */
function pickHandshakeFields(bridge: NativeBridgeGlobal): unknown {
  const source = bridge as unknown as Record<string, unknown>;
  return {
    bridgeVersion: source.bridgeVersion,
    appVersion: source.appVersion,
    platform: source.platform,
    profileMode: source.profileMode,
    secureContext: source.secureContext,
    safeArea: source.safeArea,
    capabilities: source.capabilities,
  };
}

function buildNativeShell(): NativeShell | null {
  const bridge = readBridgeGlobal();
  if (bridge === null) return null;
  const handshake = parseNativeShellHandshake(pickHandshakeFields(bridge));
  if (handshake === null) return null;
  // A shell far newer or older than this page is still usable; only a
  // nonsense version means "pretend there is no bridge".
  if (!isBridgeUsable(compareBridgeVersions(handshake.bridgeVersion))) {
    return null;
  }
  const capabilities = new Set<NativeCapability>(handshake.capabilities);
  return {
    handshake,
    safeArea: () => {
      // The shell mutates `safeArea` in place on rotation, so re-read it
      // rather than trusting the value captured at boot.
      const live = safeAreaInsetsSchema.safeParse(bridge.safeArea);
      return live.success ? live.data : handshake.safeArea;
    },
    has: (capability) => capabilities.has(capability),
    post: (message) => bridge.post(message),
    request: (kind, payload) => bridge.request(kind, payload),
    subscribe: (listener) =>
      bridge.subscribe((event) => {
        const parsed = parseShellToPageEvent(event);
        // A newer shell can send an event this page never learned. Dropping
        // it is correct; throwing inside the shell's callback is not.
        if (parsed !== null) listener(parsed);
      }),
  };
}

let cached: NativeShell | null | undefined;

/**
 * The bridge, read once per page load. The shell installs it before any page
 * script runs, so a single read at boot is enough and keeps every call site
 * synchronous.
 */
export function getNativeShell(): NativeShell | null {
  if (cached === undefined) cached = buildNativeShell();
  return cached;
}

/** Tests only: drop the memoized read between cases. */
export function resetNativeShellForTests(): void {
  cached = undefined;
}

export function isInsideNativeShell(): boolean {
  return getNativeShell() !== null;
}

/**
 * Physical feedback for a semantic event. The shell owns the mapping and the
 * user's Haptics setting. On the web this is a no-op, because iOS Safari has
 * no vibration API and Android's is a blunt buzz that misreads as an error.
 */
export function shellHaptic(kind: BridgeHapticKind): void {
  const shell = getNativeShell();
  if (shell === null || !shell.has("haptic")) return;
  shell.post({ type: "haptic", kind });
}

/** The app icon's unread badge. Falls back to the Badging API on the web. */
export function shellSetBadge(count: number): void {
  const normalized = Math.max(0, Math.trunc(count));
  const shell = getNativeShell();
  if (shell !== null && shell.has("badge")) {
    shell.post({ type: "badge", count: normalized });
    return;
  }
  if (typeof navigator === "undefined") return;
  const badging = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  const update =
    normalized === 0
      ? badging.clearAppBadge?.()
      : badging.setAppBadge?.(normalized);
  void update?.catch(() => undefined);
}

/**
 * Open a link outside the page. Returns true when the shell took it, so the
 * caller can skip its own `window.open`, which a WebView would either block
 * or open in a chrome-less view the user cannot leave.
 */
export function shellOpenExternal(url: string): boolean {
  const shell = getNativeShell();
  if (shell === null || !shell.has("open-external")) return false;
  shell.post({ type: "open-external", url });
  return true;
}

/**
 * The OS share sheet. Returns null when neither the shell nor the browser can
 * share, so the caller can fall back to copying the link.
 */
export async function shellShare(
  payload: BridgeSharePayload,
): Promise<boolean | null> {
  const shell = getNativeShell();
  if (shell !== null && shell.has("share")) {
    try {
      const result = await shell.request("share", payload);
      return shareResultSchema.parse(result).shared;
    } catch {
      return null;
    }
  }
  if (typeof navigator === "undefined" || navigator.share === undefined) {
    return null;
  }
  try {
    await navigator.share(payload);
    return true;
  } catch (error) {
    // A dismissed sheet rejects with AbortError, which is not a failure.
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    return null;
  }
}

/**
 * Show a native screen the shell owns. Returns false when there is no shell,
 * or when this shell is too old to know the screen, so the caller can hide
 * the entry rather than offer a dead one.
 */
export function shellOpenNative(screen: NativeScreen): boolean {
  const shell = getNativeShell();
  if (shell === null || !shell.has("open-native")) return false;
  shell.post({ type: "open-native", screen });
  return true;
}

/** Whether the page should offer a way into the shell's own settings. */
export function canOpenNativeScreen(): boolean {
  const shell = getNativeShell();
  return shell !== null && shell.has("open-native");
}

/** Tell the shell the page painted, so it can drop its own loading state. */
export function shellReportReady(path: string): void {
  getNativeShell()?.post({ type: "ready", path });
}

/** Tell the shell the current route, so a cold start can reopen it. */
export function shellReportPath(title: string, path: string): void {
  getNativeShell()?.post({ type: "title", title, path });
}
