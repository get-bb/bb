import {
  buildBridgeEventScript,
  parsePageToShellMessage,
  type BridgeResponse,
  type NativeScreen,
  type PageToShellMessage,
  type ShellToPageEvent,
} from "@bb/mobile-bridge";
import * as Notifications from "expo-notifications";
import { useCallback, useMemo, useRef } from "react";
import { Linking, Platform, Share } from "react-native";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import { haptic } from "@/lib/haptics";
import { buildBridgeSharePayload, isExternallyOpenable } from "@/lib/shell";

/**
 * The native half of the shell/page bridge. Everything the page sends arrives
 * here already parsed; anything this build does not understand is dropped,
 * because the server can serve a page newer than the app in the store.
 */

export interface ShellBridgeCallbacks {
  /** The page painted. The screen can stop showing its own spinner. */
  onReady(path: string): void;
  /** The page's current route, remembered for the next cold start. */
  onPath(path: string): void;
  /** The page asked for a native screen the shell owns. */
  onOpenNative(screen: NativeScreen): void;
}

export interface ShellBridge {
  onMessage(event: WebViewMessageEvent): void;
  /** Push a shell event into the page (resume, rotation). */
  send(event: ShellToPageEvent): void;
}

async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // The badge needs a notification permission the user may have refused.
    // An unread count is not worth an error the user cannot act on.
  }
}

export function useShellBridge(
  webViewRef: React.RefObject<WebView | null>,
  callbacks: ShellBridgeCallbacks,
): ShellBridge {
  // Keep the latest callbacks without re-creating the message handler, which
  // would re-render the WebView on every path change.
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
    async (message: PageToShellMessage): Promise<void> => {
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
          await setBadgeCount(message.count);
          return;
        case "open-native":
          callbacksRef.current.onOpenNative(message.screen);
          return;
        case "open-external": {
          // The schema already refuses anything but http(s); this is the
          // second gate, because the value reaches the system link opener.
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
                error: error instanceof Error ? error.message : String(error),
              });
            }
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
        // A newer page, or a page that is not bb at all. Both are survivable.
        if (__DEV__)
          console.warn("shell bridge dropped a message", parsed.reason);
        return;
      }
      if (__DEV__) console.log("shell bridge", JSON.stringify(parsed.message));
      void handle(parsed.message);
    },
    [handle],
  );

  return useMemo(() => ({ onMessage, send }), [onMessage, send]);
}
