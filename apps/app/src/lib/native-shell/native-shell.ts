import {
  compareBridgeVersions,
  isBridgeUsable,
  parseNativeShellHandshake,
  nativeShellHandshakeSchema,
  safeAreaInsetsSchema,
  shareResultSchema,
  type BridgeHapticKind,
  type BridgeSharePayload,
  type NativeScreen,
  type NativeCapability,
  type NativeShellHandshake,
  type PageToShellMessage,
  type SafeAreaInsets,
  type ShareResult,
  type ShellToPageEvent,
} from "@bb/mobile-bridge";
import { z } from "zod";

interface NativeBridgeContainer {
  native?: object;
}

declare global {
  interface Window {
    bb?: NativeBridgeContainer;
  }
}

interface NativeBridgeGlobal extends NativeShellHandshake {
  post(message: PageToShellMessage): void;
  request(kind: "share", payload: BridgeSharePayload): Promise<ShareResult>;
  subscribe(listener: (event: ShellToPageEvent) => void): () => void;
}

const nativeBridgeContractSchema = nativeShellHandshakeSchema
  .extend({
    post: z.function(),
    request: z.function(),
    subscribe: z.function(),
  })
  .passthrough();

const nativeBridgeSchema = z.custom<NativeBridgeGlobal>(
  (value) => nativeBridgeContractSchema.safeParse(value).success,
);

export interface NativeShell {
  handshake: NativeShellHandshake;
  safeArea(): SafeAreaInsets;
  has(capability: NativeCapability): boolean;
  post(message: PageToShellMessage): void;
  request(kind: "share", payload: BridgeSharePayload): Promise<ShareResult>;
  subscribe(listener: (event: ShellToPageEvent) => void): () => void;
}

function readBridgeGlobal(): NativeBridgeGlobal | null {
  const parsed = nativeBridgeSchema.safeParse(globalThis.window?.bb?.native);
  return parsed.success ? parsed.data : null;
}

function buildNativeShell(): NativeShell | null {
  const bridge = readBridgeGlobal();
  if (bridge === null) return null;
  const handshake = parseNativeShellHandshake({
    bridgeVersion: bridge.bridgeVersion,
    appVersion: bridge.appVersion,
    platform: bridge.platform,
    profileMode: bridge.profileMode,
    secureContext: bridge.secureContext,
    safeArea: bridge.safeArea,
    capabilities: bridge.capabilities,
  });
  if (handshake === null) return null;
  if (!isBridgeUsable(compareBridgeVersions(handshake.bridgeVersion))) {
    return null;
  }
  const capabilities = new Set<NativeCapability>(handshake.capabilities);
  return {
    handshake,
    safeArea: () => {
      const live = safeAreaInsetsSchema.safeParse(bridge.safeArea);
      return live.success ? live.data : handshake.safeArea;
    },
    has: (capability) => capabilities.has(capability),
    post: bridge.post,
    request: async (kind, payload) =>
      shareResultSchema.parse(await bridge.request(kind, payload)),
    subscribe: bridge.subscribe,
  };
}

let cached: NativeShell | null | undefined;

export function getNativeShell(): NativeShell | null {
  if (cached === undefined) cached = buildNativeShell();
  return cached;
}

export function resetNativeShellForTests(): void {
  cached = undefined;
}

export function isInsideNativeShell(): boolean {
  return getNativeShell() !== null;
}

export function shellHaptic(kind: BridgeHapticKind): void {
  const shell = getNativeShell();
  if (shell === null || !shell.has("haptic")) return;
  shell.post({ type: "haptic", kind });
}

export function shellSetBadge(count: number): void {
  const normalized = Math.max(0, Math.trunc(count));
  const shell = getNativeShell();
  if (shell !== null && shell.has("badge")) {
    shell.post({ type: "badge", count: normalized });
    return;
  }
  const update =
    normalized === 0
      ? globalThis.navigator?.clearAppBadge?.()
      : globalThis.navigator?.setAppBadge?.(normalized);
  void update?.catch(() => undefined);
}

export function shellOpenExternal(url: string): boolean {
  const shell = getNativeShell();
  if (shell === null || !shell.has("open-external")) return false;
  shell.post({ type: "open-external", url });
  return true;
}

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
  const browserNavigator = globalThis.navigator;
  if (browserNavigator?.share === undefined) {
    return null;
  }
  try {
    await browserNavigator.share(payload);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    return null;
  }
}

export function shellOpenNative(screen: NativeScreen): boolean {
  const shell = getNativeShell();
  if (shell === null || !shell.has("open-native")) return false;
  shell.post({ type: "open-native", screen });
  return true;
}

export function canOpenNativeScreen(): boolean {
  const shell = getNativeShell();
  return shell !== null && shell.has("open-native");
}

export function shellReportReady(path: string): void {
  getNativeShell()?.post({ type: "ready", path });
}

export function shellReportPath(title: string, path: string): void {
  getNativeShell()?.post({ type: "title", title, path });
}
