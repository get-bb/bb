import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { ProviderRetryBannerView } from "./banner.js";
import type {
  providerRetryRpcContract,
  ProviderRetryView,
} from "./src/contract.js";

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
    <ProviderRetryBannerForThread
      key={composerView.scope.threadId}
      threadId={composerView.scope.threadId}
    />
  );
}

function ProviderRetryBannerForThread({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof providerRetryRpcContract>();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [cancelling, setCancelling] = useState(false);
  const [view, setView] = useState<ProviderRetryView | null>(null);

  const load = useCallback(async () => {
    const result = await rpc.call("providerRetryStatus", { threadId });
    setView(result.view);
  }, [rpc, threadId]);

  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      const result = await rpc.call("providerRetryCancel", { threadId });
      if (result.cancelled) {
        setView(null);
      } else {
        await load();
      }
    } catch {
      await load().catch(() => undefined);
    } finally {
      setCancelling(false);
    }
  }, [load, rpc, threadId]);

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

  return view === null ? null : (
    <ProviderRetryBannerView
      cancelling={cancelling}
      onCancel={cancel}
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
