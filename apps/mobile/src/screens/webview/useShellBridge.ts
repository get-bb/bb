import {
  buildBridgeEventScript,
  parsePageToShellMessage,
  type BridgeResponse,
  type NativeScreen,
  type PageToShellMessage,
  type ShellToPageEvent,
} from "@bb/mobile-bridge";
import {
  base64UrlDecode,
  base64UrlEncode,
  createDelegation,
  type DeviceIdentity,
} from "@bb/sealed-channel";
import { useCallback, useMemo, useRef } from "react";
import { Linking, Platform, Share } from "react-native";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import { describeError } from "@/lib/describe-error";
import type { SealedServerTrust } from "@/lib/profiles";
import { haptic } from "@/lib/haptics";
import { buildBridgeSharePayload, isExternallyOpenable } from "@/lib/shell";
import { updateAppBadgeCount } from "@/notifications/AppBadgeSync";

export interface ShellBridgeSealed {
  identity(): Promise<DeviceIdentity>;
  deviceName: string;
  trustFor(origin: string): SealedServerTrust | null;
  expectsSealed(origin: string): boolean;
}

export interface ShellBridgeCallbacks {
  onReady(path: string): void;
  onPath(path: string): void;
  onOpenNative(screen: NativeScreen): void;
  sealed?: ShellBridgeSealed;
}

export const SEALED_PAGE_DELEGATION_TTL_MS = 12 * 60 * 60 * 1000;

export function pageOrigin(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export interface ShellBridge {
  onMessage(event: WebViewMessageEvent): void;
  send(event: ShellToPageEvent): void;
}

export function useShellBridge(
  webViewRef: React.RefObject<WebView | null>,
  callbacks: ShellBridgeCallbacks,
): ShellBridge {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const send = useCallback(
    (event: ShellToPageEvent) => {
      webViewRef.current?.injectJavaScript(buildBridgeEventScript(event));
    },
    [webViewRef],
  );

  const respond = useCallback(
    (id: string, response: BridgeResponse) => {
      send({ type: "response", id, response });
    },
    [send],
  );

  const handle = useCallback(
    async (
      message: PageToShellMessage,
      origin: string | null,
    ): Promise<void> => {
      switch (message.type) {
        case "ready":
          callbacksRef.current.onReady(message.path);
          return;
        case "title":
          callbacksRef.current.onPath(message.path);
          return;
        case "haptic":
          haptic(message.kind);
          return;
        case "badge":
          updateAppBadgeCount(message.count);
          return;
        case "open-native":
          callbacksRef.current.onOpenNative(message.screen);
          return;
        case "open-external": {
          if (!isExternallyOpenable(message.url)) return;
          await Linking.openURL(message.url).catch(() => undefined);
          return;
        }
        case "request": {
          if (message.request.kind === "share") {
            const payload = buildBridgeSharePayload(
              Platform.OS,
              message.request.payload,
            );
            try {
              const result = await Share.share(
                payload.content,
                payload.options,
              );
              respond(message.id, {
                ok: true,
                result: { shared: result.action !== Share.dismissedAction },
              });
            } catch (error) {
              respond(message.id, {
                ok: false,
                error: describeError(error),
              });
            }
            return;
          }
          if (
            message.request.kind === "clipboard" ||
            message.request.kind === "clipboard-html"
          ) {
            return;
          }
          const sealed = callbacksRef.current.sealed;
          const trust =
            origin === null ? null : (sealed?.trustFor(origin) ?? null);
          if (sealed === undefined || origin === null) {
            respond(message.id, {
              ok: false,
              error: "end-to-end encryption is unavailable in this shell",
            });
            return;
          }
          try {
            if (message.request.kind === "sealed-identity") {
              if (trust === null) {
                respond(message.id, {
                  ok: false,
                  error: "this page is not the paired server",
                });
                return;
              }
              const identity = await sealed.identity();
              respond(message.id, {
                ok: true,
                result: {
                  publicKey: base64UrlEncode(identity.publicKey),
                  deviceName: sealed.deviceName,
                },
              });
              return;
            }
            if (message.request.kind === "sealed-delegate") {
              if (
                trust === null ||
                trust.serverKey !== message.request.payload.serverKey
              ) {
                respond(message.id, {
                  ok: false,
                  error:
                    "this page is not the pinned server for the active profile",
                });
                return;
              }
              const identity = await sealed.identity();
              const delegation = await createDelegation(
                identity,
                base64UrlDecode(message.request.payload.publicKey),
                Date.now() + SEALED_PAGE_DELEGATION_TTL_MS,
                base64UrlDecode(trust.serverKey),
              );
              respond(message.id, {
                ok: true,
                result: {
                  parentPublicKey: base64UrlEncode(delegation.parentPublicKey),
                  expiresAt: delegation.expiresAt,
                  signature: base64UrlEncode(delegation.signature),
                },
              });
              return;
            }
            const requestedOrigin = message.request.payload.origin;
            const requested = requestedOrigin === origin ? trust : null;
            const expected =
              requestedOrigin === origin && sealed.expectsSealed(origin);
            respond(message.id, {
              ok: true,
              result:
                requested === null
                  ? { expected, serverKey: null }
                  : {
                      expected: true,
                      serverKey: requested.serverKey,
                      fingerprint: requested.fingerprint,
                      verified: requested.verified,
                    },
            });
          } catch (error) {
            respond(message.id, { ok: false, error: describeError(error) });
          }
          return;
        }
      }
    },
    [respond],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const parsed = parsePageToShellMessage(event.nativeEvent.data);
      if (!parsed.ok) {
        if (__DEV__)
          console.warn("shell bridge dropped a message", parsed.reason);
        return;
      }
      if (__DEV__) console.log("shell bridge", JSON.stringify(parsed.message));
      void handle(parsed.message, pageOrigin(event.nativeEvent.url));
    },
    [handle],
  );

  return useMemo(() => ({ onMessage, send }), [onMessage, send]);
}
