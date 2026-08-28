import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  definePluginApp,
  experimental_useProviders,
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
const providerRetryRealtimePayloadSchema = z
  .object({ threadId: z.string().min(1) })
  .passthrough();

function payloadThreadId(payload: JsonValue): string | null {
  const parsed = providerRetryRealtimePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.threadId : null;
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
    void Promise.resolve()
      .then(load)
      .catch(() => undefined);
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

  const { providers } = experimental_useProviders();
  const providerName =
    view === null
      ? ""
      : (providers.find((provider) => provider.id === view.providerId)
          ?.displayName ?? view.providerId);

  return view === null ? null : (
    <ProviderRetryBannerView
      cancelling={cancelling}
      onCancel={cancel}
      providerName={providerName}
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
