import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  machineMeasurementHostContract,
  machineLoadBalancerRpcContract,
  type InspectInput,
  type Machine,
  type Overview,
  type ProvidersObservation,
  type RunningThread,
} from "./contract.js";
import {
  decidePlacement,
  expireStaleReading,
  hostAvailability,
  loadReading,
  machineProviders,
  nextPick,
  rankMachines,
  type Measurement,
  type SourceObservation,
} from "./placement.js";

export const MEASUREMENT_TIMEOUT_MS = 5_000;

type RunningEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["listRunning"]>
>[number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatThread(thread: RunningThread): string {
  const model = thread.model === null ? "" : ` ${thread.model}`;
  return `${thread.title ?? thread.id} [${thread.id}] (${thread.status}, ${thread.providerName}${model})`;
}

function formatOverview(overview: Overview): string {
  const lines = overview.machines.map((machine) => {
    const tags = [
      machine.isServer ? "server" : null,
      machine.hostId === overview.nextPickHostId ? "next pick" : null,
    ].filter((tag) => tag !== null);
    const heading = `${machine.name}${tags.length === 0 ? "" : ` (${tags.join(", ")})`} [${machine.hostId}]`;
    if (machine.availability.kind === "unavailable") {
      return `${heading}: unavailable: ${machine.availability.reason}`;
    }
    const capacity =
      machine.capacity.kind === "known"
        ? `${machine.capacity.capacity.availableParallelism} CPU, ${Math.round(machine.capacity.capacity.totalMemoryBytes / 1024 ** 3)} GB`
        : `capacity unavailable: ${machine.capacity.reason}`;
    const load =
      machine.load.kind === "fresh"
        ? `load ${(machine.load.oneMinuteLoad / machine.load.availableParallelism).toFixed(2)}/CPU (1-min ${machine.load.oneMinuteLoad.toFixed(2)})`
        : `load unavailable: ${machine.load.reason}`;
    const providers =
      machine.providers.kind === "unavailable"
        ? `providers unknown: ${machine.providers.reason}`
        : machine.providers.providers
            .map((provider) =>
              provider.readiness.kind === "ready"
                ? `${provider.displayName} ready`
                : `${provider.displayName} ${provider.readiness.label}`,
            )
            .join(", ");
    const running =
      machine.runningThreads.length === 0
        ? "no running threads"
        : `running ${machine.runningThreads.map(formatThread).join(", ")}`;
    return `${heading}: ${capacity}; ${load}; ${providers}; ${running}`;
  });
  if (overview.pendingThreads.length > 0) {
    lines.push(
      `Pending placement: ${overview.pendingThreads.map(formatThread).join(", ")}`,
    );
  }
  const { placement } = overview;
  if (placement.kind !== "not-requested") {
    lines.push(
      placement.kind === "chosen"
        ? `Placement: ${placement.machine.name}. ${placement.reason}`
        : `Placement: stay on server. ${placement.reason}`,
      ...placement.skipped.map(
        (skipped) => `Skipped ${skipped.name}: ${skipped.label}`,
      ),
    );
  }
  return lines.join("\n");
}

export default function machineLoadBalancerPlugin(bb: BbPluginApi): void {
  const lifetime = new AbortController();
  bb.onDispose(() => lifetime.abort());
  const hostClient = bb.hosts.experimental_client({
    contract: machineMeasurementHostContract,
  });

  function bounded(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(MEASUREMENT_TIMEOUT_MS)]);
  }

  async function measure(hostId: string, signal: AbortSignal): Promise<Measurement> {
    const requestedAt = Date.now();
    try {
      const measurement = await hostClient.call("measure", null, {
        hostId,
        signal: bounded(signal),
      });
      return { kind: "measured", measurement, requestedAt };
    } catch (error) {
      return {
        kind: "failed",
        reason: `Measurement failed: ${errorMessage(error)}`,
      };
    }
  }

  async function probeProviders(
    hostId: string,
    signal: AbortSignal,
  ): Promise<ProvidersObservation> {
    try {
      const { providers } = await bb.sdk.system.providerStates({
        hostId,
        signal: bounded(signal),
      });
      return { kind: "reported", providers: machineProviders(providers) };
    } catch (error) {
      return {
        kind: "unavailable",
        reason: `Provider readiness could not be checked: ${errorMessage(error)}`,
      };
    }
  }

  async function checkSource(
    hostId: string,
    path: string,
    signal: AbortSignal,
  ): Promise<SourceObservation> {
    try {
      return await hostClient.call("checkSource", { path }, {
        hostId,
        signal: bounded(signal),
      });
    } catch (error) {
      return { kind: "failed", reason: `Source check failed: ${errorMessage(error)}` };
    }
  }

  async function inspect(
    input: InspectInput,
    signal: AbortSignal = lifetime.signal,
  ): Promise<Overview> {
    const [hosts, project, running, config] = await Promise.all([
      bb.sdk.hosts.list({ signal }),
      input.kind === "placement"
        ? bb.sdk.projects.get({ projectId: input.projectId, signal })
        : Promise.resolve(null),
      bb.sdk.threads.listRunning({ signal }),
      bb.sdk.system.config({ signal }),
    ]);
    const sources = new Map<string, SourceObservation>();
    const machines = await Promise.all(
      hosts.map(async (host) => {
        const availability = hostAvailability(host);
        if (availability.kind === "unavailable") {
          return {
            host,
            availability,
            measurement: { kind: "failed", reason: availability.reason } satisfies Measurement,
            providers: {
              kind: "unavailable",
              reason: availability.reason,
            } satisfies ProvidersObservation,
          };
        }
        const source =
          project === null || project.kind === "personal"
            ? undefined
            : project.sources.find(
                (candidate) =>
                  candidate.hostId === host.id && candidate.type === "local_path",
              );
        const [providers, sourceObservation] = await Promise.all([
          probeProviders(host.id, signal),
          project === null
            ? Promise.resolve(null)
            : project.kind === "personal"
              ? Promise.resolve<SourceObservation>({ kind: "available" })
              : source === undefined
                ? Promise.resolve<SourceObservation>({ kind: "missing" })
                : checkSource(host.id, source.path, signal),
        ]);
        if (sourceObservation !== null) sources.set(host.id, sourceObservation);
        if (signal.aborted) throw signal.reason;
        return {
          host,
          availability,
          measurement: await measure(host.id, signal),
          providers,
        };
      }),
    );
    if (signal.aborted) throw signal.reason;
    const inspectedAt = Date.now();
    const providerNames = new Map<string, string>();
    for (const { providers } of machines) {
      if (providers.kind !== "reported") continue;
      for (const provider of providers.providers) {
        providerNames.set(provider.providerId, provider.displayName);
      }
    }
    const describe = (thread: RunningEntry): RunningThread => ({
      id: thread.id,
      title: thread.title,
      status: thread.status,
      providerId: thread.providerId,
      providerName: providerNames.get(thread.providerId) ?? thread.providerId,
      model: thread.model,
      runningSince: thread.runningSince,
    });
    const observed = machines.map(
      ({ host, availability, measurement, providers }): Machine => ({
        hostId: host.id,
        name: host.name,
        isServer: host.id === config.primaryHostId,
        availability,
        capacity:
          measurement.kind === "measured"
            ? { kind: "known", capacity: measurement.measurement.capacity }
            : { kind: "unavailable", reason: measurement.reason },
        load: expireStaleReading(loadReading(measurement), inspectedAt),
        providers,
        runningThreads: running
          .filter((thread) => thread.hostId === host.id)
          .map(describe),
      }),
    );
    return {
      inspectedAt,
      machines: rankMachines(observed, inspectedAt),
      nextPickHostId: nextPick(observed, inspectedAt),
      pendingThreads: running
        .filter((thread) => thread.hostId === null)
        .map(describe),
      placement:
        input.kind === "placement" && project !== null
          ? decidePlacement(
              observed,
              {
                projectName: project.name,
                providerId: input.providerId,
                sources,
              },
              inspectedAt,
            )
          : { kind: "not-requested" },
    };
  }

  bb.rpc.register(machineLoadBalancerRpcContract, {
    inspect: (input, context) =>
      inspect(input, AbortSignal.any([context.experimental_signal, lifetime.signal])),
  });

  bb.experimental_hooks.on("experimental_thread.place", async ({ projectId, providerId, signal }) => {
    const { placement } = await inspect(
      { kind: "placement", projectId, providerId },
      AbortSignal.any([signal, lifetime.signal]),
    );
    if (placement.kind === "not-requested") {
      return { kind: "default", reason: "Placement was not requested.", skipped: [] };
    }
    const skipped = placement.skipped.map((skip) => ({ hostId: skip.hostId, reason: skip.label }));
    return placement.kind === "chosen"
      ? {
          kind: "choose",
          hostId: placement.machine.hostId,
          requestedAt: placement.machine.requestedAt,
          skipped,
        }
      : { kind: "default", reason: placement.reason, skipped };
  });

  bb.cli.register(
    defineCli({
      name: "placement",
      summary: "Inspect machine capacity, load, readiness, and placement",
      description:
        "Measures every connected machine now: available processors, total physical memory, the 1-minute OS load average (scheduler load, not CPU percent), per-provider readiness, and running threads. Pass --project and --provider together to add the placement decision for that pair.",
      commands: {
        inspect: cliCommand({
          summary: "Show every machine, and optionally the placement a project and provider would get",
          options: {
            project: {
              type: "string",
              aliases: ["project-id"],
              description: "Project id, as `bb project list` prints it; requires --provider",
            },
            provider: {
              type: "string",
              aliases: ["provider-id"],
              description: "Agent provider id, such as claude-code or codex; requires --project",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          constraints: [
            { kind: "requires", option: "project", needs: ["provider"] },
            { kind: "requires", option: "provider", needs: ["project"] },
          ],
          async run(command) {
            const { project, provider } = command.options;
            const overview = await inspect(
              project === undefined || provider === undefined
                ? { kind: "all" }
                : { kind: "placement", projectId: project, providerId: provider },
            );
            return {
              exitCode: 0,
              stdout: command.options.json ? JSON.stringify(overview) : formatOverview(overview),
            };
          },
        }),
      },
    }),
  );
}
