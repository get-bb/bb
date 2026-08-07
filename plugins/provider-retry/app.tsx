import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@bb/plugin-sdk/app";
import {
  ProviderRetryBannerView,
  type ProviderRetryBannerAction,
} from "./banner.js";
import type { providerRetryRpcContract } from "./src/contract.js";
import type { ProviderRetryView } from "./src/contract.js";

const REALTIME_CHANNEL = "provider-retry";

function payloadThreadId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const threadId = (payload as { threadId?: unknown }).threadId;
  return typeof threadId === "string" ? threadId : null;
}

function ProviderRetryBanner() {
  const composerView = useComposerView();
  if (composerView.scope.kind !== "thread") return null;
  return (
    <ProviderRetryBannerForThread threadId={composerView.scope.threadId} />
  );
}

function ProviderRetryBannerForThread({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof providerRetryRpcContract>();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [view, setView] = useState<ProviderRetryView | null>(null);
  const [busy, setBusy] = useState<ProviderRetryBannerAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await rpc.call("providerRetryStatus", { threadId });
    setView(result.view);
  }, [rpc, threadId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useRealtime(
    REALTIME_CHANNEL,
    useCallback(
      (payload) => {
        if (payloadThreadId(payload) === threadId) {
          void load().catch(() => undefined);
        }
      },
      [load, threadId],
    ),
  );

  useEffect(() => {
    const reconnected =
      connection === "connected" && previousConnection.current !== "connected";
    previousConnection.current = connection;
    if (reconnected) void load().catch(() => undefined);
  }, [connection, load]);

  const runAction = useCallback(
    async (action: ProviderRetryBannerAction) => {
      setBusy(action);
      setActionError(null);
      try {
        if (action === "cancel") {
          const result = await rpc.call("providerRetryCancel", { threadId });
          if (result.cancelled) {
            setView(null);
          } else {
            await load();
            setActionError("This continuation is already in progress.");
          }
        } else {
          const result = await rpc.call("providerRetryNow", { threadId });
          setView(result.view);
          if (
            !result.started &&
            result.view?.phase !== "retry-failed" &&
            result.view?.phase !== "waiting-for-host"
          ) {
            setActionError("This turn is no longer available to continue.");
          }
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [load, rpc, threadId],
  );

  if (view === null) return null;
  return (
    <ProviderRetryBannerView
      actionError={actionError}
      busy={busy}
      onAction={runAction}
      view={view}
    />
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "provider-retry-status",
    scopes: ["thread"],
    banners: [
      {
        id: "subscription-recovery",
        chrome: "bare",
        component: ProviderRetryBanner,
      },
    ],
  });
});
