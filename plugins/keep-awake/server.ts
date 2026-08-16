import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { keepAwakeHostContract } from "./contract.js";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

type ReconcileOutcome = "settled" | "retry";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function keepAwakePlugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Keep this Mac awake",
      description:
        "Prevent system idle sleep while bb is running. Closing the lid or choosing Sleep still sleeps the Mac.",
      default: false,
    },
  });
  const host = bb.hosts.experimental_client({
    contract: keepAwakeHostContract,
  });

  let reconcileRequested = true;
  let wakeWaiter: (() => void) | null = null;

  function requestReconcile(): void {
    reconcileRequested = true;
    wakeWaiter?.();
  }

  settings.onChange(requestReconcile);
  host.onSignal("stateChanged", ({ payload, target }) => {
    const hostId = target.hostId;
    if (payload.enabled) {
      bb.log.info(`Keep Awake resumed on host ${hostId}`);
    } else if (payload.supported) {
      bb.log.warn(
        `Keep Awake stopped unexpectedly on host ${hostId}; retrying`,
      );
      requestReconcile();
    }
  });

  async function reconcile(signal: AbortSignal): Promise<ReconcileOutcome> {
    try {
      const [{ enabled }, config, availableHosts] = await Promise.all([
        settings.get(),
        bb.sdk.system.config(),
        bb.sdk.hosts.list(),
      ]);
      const outcomes = await Promise.all(
        availableHosts
          .filter((availableHost) => availableHost.status === "connected")
          .map(async (availableHost): Promise<ReconcileOutcome> => {
            const desired =
              enabled && availableHost.id === config.primaryHostId;
            try {
              const actual = await host.call(
                "setEnabled",
                { enabled: desired },
                { target: { hostId: availableHost.id }, signal },
              );
              if (!actual.supported) {
                if (desired) {
                  bb.log.warn(
                    "Keep Awake is enabled but the primary host is not macOS",
                  );
                }
                return "settled";
              }
              if (actual.enabled !== desired) {
                bb.log.warn(
                  `Keep Awake did not reach its configured state on host ${availableHost.id}; retrying`,
                );
                return "retry";
              }
              return "settled";
            } catch (error) {
              if (signal.aborted) return "settled";
              bb.log.warn(
                `Could not reconcile Keep Awake on host ${availableHost.id}: ${errorMessage(error)}`,
              );
              return "retry";
            }
          }),
      );
      return outcomes.includes("retry") ? "retry" : "settled";
    } catch (error) {
      if (signal.aborted) return "settled";
      bb.log.warn(`Could not load Keep Awake state: ${errorMessage(error)}`);
      return "retry";
    }
  }

  function waitForReconcile(
    signal: AbortSignal,
    retryMs: number | null,
  ): Promise<void> {
    if (signal.aborted || reconcileRequested) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (wakeWaiter === finish) wakeWaiter = null;
        signal.removeEventListener("abort", finish);
        resolve();
      };
      wakeWaiter = finish;
      signal.addEventListener("abort", finish, { once: true });
      if (retryMs !== null) timer = setTimeout(finish, retryMs);
      if (signal.aborted || reconcileRequested) finish();
    });
  }

  bb.background.service("desired-state-reconciler", {
    async start(signal) {
      const unsubscribeHost = bb.sdk.subscribe({
        event: "host:changed",
        callback: (event) => {
          if (event.changes.includes("host-connected")) requestReconcile();
        },
      });
      const unsubscribeConfig = bb.sdk.subscribe({
        event: "system:config-changed",
        callback: requestReconcile,
      });
      const unsubscribeRealtime = bb.sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          if (event.state === "connected" && event.reconnected) {
            requestReconcile();
          }
        },
      });
      let retryMs = RETRY_MIN_MS;
      try {
        while (!signal.aborted) {
          reconcileRequested = false;
          const outcome = await reconcile(signal);
          if (signal.aborted) break;
          if (reconcileRequested) continue;
          if (outcome === "retry") {
            await waitForReconcile(signal, retryMs);
            retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
          } else {
            retryMs = RETRY_MIN_MS;
            await waitForReconcile(signal, null);
          }
        }
      } finally {
        unsubscribeRealtime();
        unsubscribeConfig();
        unsubscribeHost();
        wakeWaiter?.();
        wakeWaiter = null;
      }
    },
  });
}
