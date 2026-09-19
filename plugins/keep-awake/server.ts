import {
  defineRpcContract,
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { keepAwakeHostContract } from "./contract.js";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const CONFIGURATION_KEY = "configuration";
const MAX_SELECTED_HOSTS = 256;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

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
const keepAwakeConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    selection: hostSelectionSchema,
  })
  .strict();
const hostConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    selection: hostSelectionSchema,
    hosts: z.array(hostSummarySchema),
  })
  .strict();

export const keepAwakeRpcContract = defineRpcContract({
  getConfiguration: {
    input: z.null(),
    output: hostConfigurationSchema,
  },
  setConfiguration: {
    input: keepAwakeConfigurationSchema,
    output: hostConfigurationSchema,
  },
});

type HostSelection = z.infer<typeof hostSelectionSchema>;
type KeepAwakeConfiguration = z.infer<typeof keepAwakeConfigurationSchema>;

type ReconcileOutcome = "settled" | "retry";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSelection(selection: HostSelection): HostSelection {
  if (selection.mode === "all") return selection;
  return { mode: "selected", hostIds: [...new Set(selection.hostIds)] };
}

function normalizeConfiguration(
  configuration: KeepAwakeConfiguration,
): KeepAwakeConfiguration {
  return {
    enabled: configuration.enabled,
    selection: normalizeSelection(configuration.selection),
  };
}

export default async function keepAwakePlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: keepAwakeHostContract,
  });

  let reconcileRequested = true;
  let retryRequested = false;
  let wakeWaiter: (() => void) | null = null;
  const storedConfiguration = keepAwakeConfigurationSchema.safeParse(
    await bb.storage.kv.get<unknown>(CONFIGURATION_KEY),
  );
  let configuration: KeepAwakeConfiguration = storedConfiguration.success
    ? normalizeConfiguration(storedConfiguration.data)
    : { enabled: false, selection: { mode: "all" } };

  function requestReconcile(): void {
    reconcileRequested = true;
    wakeWaiter?.();
  }

  function requestRetry(): void {
    retryRequested = true;
    wakeWaiter?.();
  }

  async function readHostConfiguration() {
    const availableHosts = await bb.sdk.hosts.list();
    return {
      ...configuration,
      hosts: availableHosts.map(({ id, name, status }) => ({
        id,
        name,
        status,
      })),
    };
  }

  async function saveConfiguration(
    next: KeepAwakeConfiguration,
  ): Promise<void> {
    const normalized = normalizeConfiguration(next);
    await bb.storage.kv.set(CONFIGURATION_KEY, normalized);
    configuration = normalized;
    requestReconcile();
  }

  bb.rpc.register(keepAwakeRpcContract, {
    getConfiguration: readHostConfiguration,
    async setConfiguration(next) {
      await saveConfiguration(next);
      return readHostConfiguration();
    },
  });

  async function setEnabled(
    enabled: boolean,
    json: boolean,
  ): Promise<{ exitCode: number; stdout: string }> {
    await saveConfiguration({ ...configuration, enabled });
    return {
      exitCode: 0,
      stdout: json
        ? JSON.stringify(configuration)
        : `Keep Awake ${configuration.enabled ? "enabled" : "disabled"}`,
    };
  }

  bb.cli.register(
    defineCli({
      name: "keep-awake",
      summary: "Configure macOS idle-sleep prevention",
      description:
        "Keep Awake holds an idle-sleep assertion on every selected macOS host while bb runs.",
      commands: {
        status: cliCommand({
          summary: "Show whether Keep Awake is enabled and which hosts it uses",
          options: { json: JSON_OPTION },
          run: (input) => ({
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify(configuration)
              : `${configuration.enabled ? "Enabled" : "Disabled"}\nHosts: ${
                  configuration.selection.mode === "all"
                    ? "all"
                    : configuration.selection.hostIds.join(", ")
                }`,
          }),
        }),
        enable: cliCommand({
          summary: "Enable Keep Awake",
          options: { json: JSON_OPTION },
          run: (input) => setEnabled(true, input.options.json),
        }),
        disable: cliCommand({
          summary: "Disable Keep Awake",
          options: { json: JSON_OPTION },
          run: (input) => setEnabled(false, input.options.json),
        }),
        hosts: cliCommand({
          summary: "Show or replace the Keep Awake host selection",
          positionals: [
            {
              name: "host-id",
              description: `Host ids to keep awake, at most ${MAX_SELECTED_HOSTS}, or the single word "all"; omit every id to print the current selection`,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const requested = input.positionals["host-id"];
            if (requested[0] === "all") {
              if (requested.length !== 1) {
                throw new PluginCliError(
                  '"all" cannot be combined with individual host ids',
                  {
                    code: "invalid_host_selection",
                    hint: "Run `bb keep-awake hosts all`, or list only host ids.",
                  },
                );
              }
              await saveConfiguration({
                ...configuration,
                selection: { mode: "all" },
              });
            } else if (requested.length > 0) {
              if (requested.length > MAX_SELECTED_HOSTS) {
                throw new PluginCliError(
                  `Select at most ${MAX_SELECTED_HOSTS} hosts, or use "all"`,
                  { code: "invalid_host_selection" },
                );
              }
              if (requested.some((hostId) => hostId.length === 0)) {
                throw new PluginCliError("Host ids cannot be empty", {
                  code: "invalid_host_selection",
                });
              }
              await saveConfiguration({
                ...configuration,
                selection: { mode: "selected", hostIds: requested },
              });
            }
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(configuration.selection)
                : configuration.selection.mode === "all"
                  ? "All hosts"
                  : configuration.selection.hostIds.join("\n"),
            };
          },
        }),
      },
    }),
  );

  host.experimental_onWorkerExit(({ hostId }) => {
    bb.log.warn(
      `Keep Awake host worker exited unexpectedly on host ${hostId}; retrying`,
    );
    requestRetry();
  });

  async function reconcile(signal: AbortSignal): Promise<ReconcileOutcome> {
    try {
      const desiredConfiguration = configuration;
      const availableHosts = await bb.sdk.hosts.list();
      const selectedHostIds = new Set(
        desiredConfiguration.selection.mode === "selected"
          ? desiredConfiguration.selection.hostIds
          : [],
      );
      const outcomes = await Promise.all(
        availableHosts
          .filter((availableHost) => availableHost.status === "connected")
          .map(async (availableHost): Promise<ReconcileOutcome> => {
            const desired =
              desiredConfiguration.enabled &&
              (desiredConfiguration.selection.mode === "all" ||
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
    options: { readonly retryDelayMs: number; readonly retryPending: boolean },
  ): Promise<void> {
    if (signal.aborted || reconcileRequested) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (wakeWaiter === wake) wakeWaiter = null;
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const armRetry = (): void => {
        if (timer !== null) return;
        timer = setTimeout(finish, options.retryDelayMs);
      };
      const wake = (): void => {
        if (signal.aborted || reconcileRequested) {
          finish();
          return;
        }
        if (retryRequested) armRetry();
      };
      wakeWaiter = wake;
      signal.addEventListener("abort", finish, { once: true });
      if (options.retryPending) armRetry();
      wake();
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
          retryRequested = false;
          const outcome = await reconcile(signal);
          if (signal.aborted) break;
          if (reconcileRequested) continue;
          const retryPending = outcome === "retry" || retryRequested;
          if (!retryPending) retryMs = RETRY_MIN_MS;
          await waitForReconcile(signal, {
            retryDelayMs: retryMs,
            retryPending,
          });
          if (retryPending || retryRequested) {
            retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
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
