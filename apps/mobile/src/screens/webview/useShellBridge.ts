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
import type { ServerProfile } from "@/lib/profiles";
import { getProfileStore } from "@/lib/native";
import { toast } from "@/ui";
import {
  acknowledgeSharedContent,
  readSharedContent,
  readSharedUploadStatus,
  startSharedUpload,
} from "@/lib/share/shared-upload-jobs";

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
  profile: ServerProfile | null,
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
          if (
            Platform.OS === "ios" &&
            hasShareId(message.path) &&
            (message.pageBridgeVersion ?? 0) < 3
          ) {
            toast.info("Update your bb server to import shared files.");
          }
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
          const current = getProfileStore().getSnapshot();
          const currentProfile =
            current.profiles.find(
              (item) => item.id === current.activeProfileId,
            ) ?? null;
          const scopedProfile =
            profile !== null &&
            currentProfile?.id === profile.id &&
            currentProfile.serverUrl === profile.serverUrl
              ? profile
              : null;
          try {
            switch (message.request.kind) {
              case "get-shared-content": {
                if (Platform.OS !== "ios" || !scopedProfile)
                  throw new Error(
                    "Choose an active server before importing a share.",
                  );
                respond(message.id, {
                  ok: true,
                  result: await readSharedContent(
                    scopedProfile,
                    message.request.payload.shareId,
                    message.request.payload.projectId,
                  ),
                });
                return;
              }
              case "start-shared-upload": {
                if (Platform.OS !== "ios" || !scopedProfile)
                  throw new Error(
                    "Choose an active server before uploading a share.",
                  );
                respond(message.id, {
                  ok: true,
                  result: startSharedUpload(
                    scopedProfile,
                    message.request.payload.shareId,
                    message.request.payload.fileId,
                    message.request.payload.projectId,
                  ),
                });
                return;
              }
              case "shared-upload-status":
                if (Platform.OS !== "ios" || !scopedProfile)
                  throw new Error(
                    "The active server changed. Reopen this share to continue.",
                  );
                respond(message.id, {
                  ok: true,
                  result: readSharedUploadStatus(
                    scopedProfile,
                    message.request.payload.jobId,
                  ),
                });
                return;
              case "acknowledge-share": {
                if (Platform.OS !== "ios" || !scopedProfile)
                  throw new Error(
                    "The active server changed. Reopen this share to continue.",
                  );
                respond(message.id, {
                  ok: true,
                  result: await acknowledgeSharedContent(
                    scopedProfile,
                    message.request.payload.shareId,
                    message.request.payload.projectId,
                  ),
                });
                return;
              }
              case "share":
              case "clipboard-html":
              case "clipboard":
                break;
            }
          } catch (error) {
            respond(message.id, { ok: false, error: describeError(error) });
            return;
          }
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
          }
          return;
        }
      }
    },
    [profile, respond],
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
      void handle(parsed.message);
    },
    [handle],
  );

  return useMemo(() => ({ onMessage, send }), [onMessage, send]);
}

function hasShareId(path: string): boolean {
  try {
    const shareId = new URL(path, "https://bb.invalid").searchParams.get(
      "shareId",
    );
    return (
      shareId !== null &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(shareId)
    );
  } catch {
    return false;
  }
}
