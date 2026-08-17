import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { keepAwakeHostContract } from "./contract.js";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const HOST_SELECTION_KEY = "host-selection";

const hostSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }).strict(),
  z
    .object({
      mode: z.literal("selected"),
      hostIds: z.array(z.string().min(1)).min(1).max(256),
    })
    .strict(),
]);
const hostSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    status: z.enum(["connected", "disconnected"]),
  })
  .strict();
const hostConfigurationSchema = z
  .object({
    selection: hostSelectionSchema,
    hosts: z.array(hostSummarySchema),
  })
  .strict();

export const keepAwakeRpcContract = defineRpcContract({
  getHostConfiguration: {
    input: z.null(),
    output: hostConfigurationSchema,
  },
  setHostSelection: {
    input: hostSelectionSchema,
    output: hostConfigurationSchema,
  },
});

type HostSelection = z.infer<typeof hostSelectionSchema>;

type ReconcileOutcome = "settled" | "retry";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSelection(selection: HostSelection): HostSelection {
  if (selection.mode === "all") return selection;
  return { mode: "selected", hostIds: [...new Set(selection.hostIds)] };
}

export default async function keepAwakePlugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Keep hosts awake",
      description:
        "Prevent idle sleep on the selected Macs while bb is running. Closing the lid or choosing Sleep still sleeps the Mac.",
      default: false,
    },
  });
  const host = bb.hosts.experimental_client({
    contract: keepAwakeHostContract,
  });

  let reconcileRequested = true;
  let wakeWaiter: (() => void) | null = null;
  const storedSelection = hostSelectionSchema.safeParse(
    await bb.storage.kv.get<unknown>(HOST_SELECTION_KEY),
  );
  let hostSelection: HostSelection = storedSelection.success
    ? normalizeSelection(storedSelection.data)
    : { mode: "all" };

  function requestReconcile(): void {
    reconcileRequested = true;
    wakeWaiter?.();
  }

  async function readHostConfiguration() {
    const availableHosts = await bb.sdk.hosts.list();
    return {
      selection: hostSelection,
      hosts: availableHosts.map(({ id, name, status }) => ({
        id,
        name,
        status,
      })),
    };
  }

  async function saveHostSelection(selection: HostSelection): Promise<void> {
    const nextSelection = normalizeSelection(selection);
    await bb.storage.kv.set(HOST_SELECTION_KEY, nextSelection);
    hostSelection = nextSelection;
    requestReconcile();
  }

  bb.rpc.register(keepAwakeRpcContract, {
    getHostConfiguration: readHostConfiguration,
    async setHostSelection(selection) {
      await saveHostSelection(selection);
      return readHostConfiguration();
    },
  });

  bb.cli.register({
    name: "keep-awake",
    summary: "Choose which hosts Keep Awake manages",
    commands: [
      {
        name: "hosts",
        summary: "Show or replace the Keep Awake host selection",
        usage: "bb keep-awake hosts [all|<host-id>...] [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...hostIds] = argv.filter((arg) => arg !== "--json");
      if (command !== "hosts") {
        return {
          exitCode: 1,
          stderr: "Usage: bb keep-awake hosts [all|<host-id>...] [--json]",
        };
      }
      if (hostIds.length > 0) {
        if (hostIds[0] === "all") {
          if (hostIds.length !== 1) {
            return {
              exitCode: 1,
              stderr: '"all" cannot be combined with individual host ids',
            };
          }
          await saveHostSelection({ mode: "all" });
        } else {
          await saveHostSelection({ mode: "selected", hostIds });
        }
      }
      return {
        exitCode: 0,
        stdout: json
          ? JSON.stringify(hostSelection)
          : hostSelection.mode === "all"
            ? "All hosts"
            : hostSelection.hostIds.join("\n"),
      };
    },
  });

  settings.onChange(requestReconcile);
  host.experimental_onWorkerExit(({ hostId }) => {
    bb.log.warn(
      `Keep Awake host worker exited unexpectedly on host ${hostId}; retrying`,
    );
    requestReconcile();
  });

  async function reconcile(signal: AbortSignal): Promise<ReconcileOutcome> {
    try {
      const [{ enabled }, availableHosts] = await Promise.all([
        settings.get(),
        bb.sdk.hosts.list(),
      ]);
      const selectedHostIds = new Set(
        hostSelection.mode === "selected" ? hostSelection.hostIds : [],
      );
      const outcomes = await Promise.all(
        availableHosts
          .filter((availableHost) => availableHost.status === "connected")
          .map(async (availableHost): Promise<ReconcileOutcome> => {
            const desired =
              enabled &&
              (hostSelection.mode === "all" ||
                selectedHostIds.has(availableHost.id));
            try {
              const actual = await host.call(
                "setEnabled",
                { enabled: desired },
                { hostId: availableHost.id, signal },
              );
              if (!actual.supported) {
                if (desired) {
                  bb.log.warn(
                    `Keep Awake is enabled but host ${availableHost.id} is not macOS`,
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
        unsubscribeHost();
        wakeWaiter?.();
        wakeWaiter = null;
      }
    },
  });
}
