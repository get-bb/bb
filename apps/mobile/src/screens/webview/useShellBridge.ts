import {
  buildBridgeEventScript,
  parsePageToShellMessage,
  type BridgeResponse,
  type NativeScreen,
  type PageToShellMessage,
  type ShellToPageEvent,
} from "@bb/mobile-bridge";
import { useCallback, useMemo, useRef } from "react";
import { Linking, Platform, Share } from "react-native";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import { describeError } from "@/lib/describe-error";
import { haptic } from "@/lib/haptics";
import { buildBridgeSharePayload, isExternallyOpenable } from "@/lib/shell";
import { updateAppBadgeCount } from "@/notifications/AppBadgeSync";
import type { ShellFileSaver } from "./useShellFileSaver";

export interface ShellBridgeCallbacks {
  onReady(path: string): void;
  onPath(path: string): void;
  onOpenNative(screen: NativeScreen): void;
}

export interface ShellBridge {
  onMessage(event: WebViewMessageEvent): void;
  send(event: ShellToPageEvent): void;
}

export function useShellBridge(
  webViewRef: React.RefObject<WebView | null>,
  callbacks: ShellBridgeCallbacks,
  fileSaver: ShellFileSaver | null,
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
          const { request } = message;
          try {
            switch (request.kind) {
              case "share": {
                const payload = buildBridgeSharePayload(
                  Platform.OS,
                  request.payload,
                );
                const result = await Share.share(
                  payload.content,
                  payload.options,
                );
                respond(message.id, {
                  ok: true,
                  result: { shared: result.action !== Share.dismissedAction },
                });
                return;
              }
              case "file-transfer-start":
              case "file-transfer-chunk":
              case "save-file": {
                if (fileSaver === null) {
                  respond(message.id, {
                    ok: false,
                    error: "Saving files is not supported here",
                  });
                  return;
                }
                if (request.kind === "file-transfer-start") {
                  const transferId = fileSaver.startTransfer(
                    request.payload.size,
                  );
                  respond(message.id, { ok: true, result: { transferId } });
                  return;
                }
                if (request.kind === "file-transfer-chunk") {
                  const { transferId, offset, data } = request.payload;
                  const received = fileSaver.appendTransfer(
                    transferId,
                    offset,
                    data,
                  );
                  respond(message.id, { ok: true, result: { received } });
                  return;
                }
                const result = await fileSaver.save(request.payload);
                respond(message.id, { ok: true, result });
                return;
              }
              default:
                return;
            }
          } catch (error) {
            respond(message.id, { ok: false, error: describeError(error) });
          }
          return;
        }
      }
    },
    [fileSaver, respond],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const parsed = parsePageToShellMessage(event.nativeEvent.data);
      if (!parsed.ok) {
        if (__DEV__)
          console.warn("shell bridge dropped a message", parsed.reason);
        return;
      }
      if (__DEV__) {
        const { message } = parsed;
        console.log(
          "shell bridge",
          message.type === "request" &&
            message.request.kind === "file-transfer-chunk"
            ? `file-transfer-chunk ${message.request.payload.offset}`
            : JSON.stringify(message),
        );
      }
      void handle(parsed.message);
    },
    [handle],
  );

  return useMemo(() => ({ onMessage, send }), [onMessage, send]);
}
