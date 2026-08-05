import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  definePluginApp,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@bb/plugin-sdk/app";
import type { providerRetryRpcContract } from "./src/contract.js";
import type { ProviderRetryView } from "./src/contract.js";

const REALTIME_CHANNEL = "provider-retry";

function providerLabel(providerId: string): string {
  switch (providerId) {
    case "codex":
      return "Codex";
    case "claudeCode":
      return "Claude Code";
    default:
      return providerId;
  }
}

function resetLabel(dueAtMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dueAtMs));
}

function limitDescription(view: ProviderRetryView): string {
  const provider = providerLabel(view.providerId);
  const window = view.windowLabel ? ` ${view.windowLabel.toLowerCase()}` : "";
  if (view.phase === "unsafe") {
    return `${provider}${window} usage limit reached, but bb cannot safely continue this turn because output or other work may already have occurred.`;
  }
  if (view.phase === "blocked") {
    const reason = view.reachedReason ?? view.overageReason;
    return `${provider} ${view.kind.replaceAll("-", " ")} limit reached${reason ? ` (${reason.replaceAll("_", " ")})` : ""}. There is no automatic reset time.`;
  }
  if (view.phase === "waiting-for-host") {
    return `${provider}${window} usage limit reset passed. This thread will continue when its host reconnects, while this bb server remains running.`;
  }
  if (view.phase === "releasing") {
    return `${provider}${window} usage is available. Continuing this thread…`;
  }
  if (view.dueAtMs !== null) {
    return `${provider}${window} usage limit reached. This thread will continue ${resetLabel(view.dueAtMs)} while this bb server remains running.`;
  }
  return `${provider}${window} usage limit reached.`;
}

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
  const [busy, setBusy] = useState<"cancel" | "now" | "refresh" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, setClockTick] = useState(0);

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

  useEffect(() => {
    if (view?.phase !== "waiting-for-reset" || view.dueAtMs === null) return;
    const interval = window.setInterval(
      () => setClockTick((tick) => tick + 1),
      1_000,
    );
    return () => window.clearInterval(interval);
  }, [view?.dueAtMs, view?.phase]);

  const runAction = useCallback(
    async (action: "cancel" | "now" | "refresh") => {
      setBusy(action);
      setActionError(null);
      try {
        if (action === "cancel") {
          await rpc.call("providerRetryCancel", { threadId });
          setView(null);
        } else if (action === "now") {
          const result = await rpc.call("providerRetryNow", { threadId });
          setView(result.view);
          if (!result.started) {
            setActionError("This turn is no longer safe to continue.");
          }
        } else {
          const result = await rpc.call("providerRetryRefresh", { threadId });
          setView(result.view);
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [rpc, threadId],
  );

  if (view === null) return null;
  const canRefresh =
    view.providerId === "codex" || view.providerId === "claudeCode";
  const canRetry = view.failedRequestId !== null && view.phase !== "releasing";

  return (
    <section
      aria-label="Provider usage recovery"
      className="flex flex-col gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-foreground"
    >
      <div className="flex items-start gap-2">
        <Icon
          name={view.phase === "releasing" ? "Spinner" : "Clock"}
          className={`mt-0.5 size-3.5 shrink-0 text-warning-text ${
            view.phase === "releasing" ? "animate-spin" : ""
          }`}
          aria-hidden
        />
        <p className="min-w-0 flex-1 leading-5">{limitDescription(view)}</p>
      </div>
      {view.refreshError === null ? null : (
        <p role="status" className="text-warning-text">
          Refresh unavailable: {view.refreshError}
        </p>
      )}
      {actionError === null ? null : (
        <p role="alert" className="text-destructive-text">
          {actionError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {canRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy !== null || view.phase === "releasing"}
            onClick={() => void runAction("refresh")}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy !== null}
            onClick={() => void runAction("now")}
          >
            {busy === "now" ? "Continuing…" : "Retry now"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={busy !== null || view.phase === "releasing"}
          onClick={() => void runAction("cancel")}
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
    </section>
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
