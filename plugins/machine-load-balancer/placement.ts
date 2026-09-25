import type { PluginBbSdk } from "@get-bb/plugin-sdk";
import type {
  Availability,
  FreshReading,
  HostMeasurement,
  LoadReading,
  Machine,
  MachineProvider,
  Placement,
  ProviderNotReadyCode,
  ProviderReadiness,
  Skip,
} from "./contract.js";

export const FRESHNESS_BOUND_MS = 30_000;

type HostRecord = Awaited<ReturnType<PluginBbSdk["hosts"]["list"]>>[number];
type ProviderState = Awaited<
  ReturnType<PluginBbSdk["system"]["providerStates"]>
>["providers"][number];

export type Measurement =
  | { kind: "measured"; measurement: HostMeasurement; requestedAt: number }
  | { kind: "failed"; reason: string };

export type SourceObservation =
  | { kind: "available" }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

export function hostAvailability(host: HostRecord): Availability {
  if (host.type !== "persistent") {
    return {
      kind: "unavailable",
      code: "ephemeral-host",
      reason: "Machine is ephemeral.",
    };
  }
  if (host.status === "disconnected") {
    return host.lastRejectedProtocolVersion === null
      ? {
          kind: "unavailable",
          code: "disconnected",
          reason: "Machine is disconnected.",
        }
      : {
          kind: "unavailable",
          code: "protocol-mismatch",
          reason: `Machine daemon speaks protocol ${host.lastRejectedProtocolVersion}, which this server rejected.`,
        };
  }
  if (host.lifecycle.phase !== "active") {
    return {
      kind: "unavailable",
      code: "lifecycle-unavailable",
      reason: `Machine is ${host.lifecycle.phase}.`,
    };
  }
  return { kind: "available" };
}

const PROVIDER_LABELS: Record<ProviderNotReadyCode, string> = {
  "provider-not-offered": "not offered",
  "provider-cli-missing": "not installed",
  "provider-cli-unsupported": "unsupported version",
  "provider-not-signed-in": "not signed in",
  "provider-sign-in-expired": "sign-in expired",
  "provider-readiness-unknown": "readiness unknown",
};

function providerNotReady(
  code: ProviderNotReadyCode,
  reason: string,
): ProviderReadiness {
  return { kind: "not-ready", code, label: PROVIDER_LABELS[code], reason };
}

export function providerReadiness(state: ProviderState): ProviderReadiness {
  const message = (fallback: string) => state.statusMessage ?? fallback;
  switch (state.status) {
    case "ready":
      return { kind: "ready" };
    case "not_installed":
      return providerNotReady(
        "provider-cli-missing",
        message("Provider CLI is not installed."),
      );
    case "unsupported_version":
      return providerNotReady(
        "provider-cli-unsupported",
        message("Provider CLI version is not supported."),
      );
    case "unauthenticated":
      return providerNotReady(
        "provider-not-signed-in",
        message("Provider is not signed in."),
      );
    case "expired":
      return providerNotReady(
        "provider-sign-in-expired",
        message("Provider sign-in has expired."),
      );
    case "unknown":
      return providerNotReady(
        "provider-readiness-unknown",
        message("Provider readiness is unknown."),
      );
  }
}

export function machineProviders(
  states: readonly ProviderState[],
): MachineProvider[] {
  return states.map((state) => ({
    providerId: state.providerId,
    displayName: state.displayName,
    readiness: providerReadiness(state),
  }));
}

export function loadReading(measurement: Measurement): LoadReading {
  if (measurement.kind === "failed") {
    return { kind: "unavailable", reason: measurement.reason };
  }
  const { oneMinuteLoad, capacity } = measurement.measurement;
  return oneMinuteLoad.kind === "unsupported"
    ? {
        kind: "unavailable",
        reason: "This machine's operating system does not report load.",
      }
    : {
        kind: "fresh",
        oneMinuteLoad: oneMinuteLoad.value,
        availableParallelism: capacity.availableParallelism,
        requestedAt: measurement.requestedAt,
      };
}

export function expireStaleReading(load: LoadReading, now: number): LoadReading {
  if (load.kind !== "fresh" || isFreshAt(load.requestedAt, now)) return load;
  return {
    kind: "unavailable",
    reason: "Load reading expired before inspection finished.",
  };
}

export function isFreshAt(observedAt: number, now: number): boolean {
  const age = now - observedAt;
  return age >= 0 && age <= FRESHNESS_BOUND_MS;
}

export function isStale(inspectedAt: number, now: number): boolean {
  return now - inspectedAt > FRESHNESS_BOUND_MS;
}

export function loadPerProcessor(reading: FreshReading): number {
  return reading.oneMinuteLoad / reading.availableParallelism;
}

function freshReading(machine: Machine, now: number): FreshReading | null {
  return machine.availability.kind === "available" &&
    machine.load.kind === "fresh" &&
    isFreshAt(machine.load.requestedAt, now)
    ? machine.load
    : null;
}

function compareIdentity(left: Machine, right: Machine): number {
  return (
    Number(right.isServer) - Number(left.isServer) ||
    (left.hostId < right.hostId ? -1 : left.hostId > right.hostId ? 1 : 0)
  );
}

export function rankMachines(
  machines: readonly Machine[],
  now: number,
): Machine[] {
  const group = (machine: Machine) =>
    machine.availability.kind !== "available"
      ? 2
      : freshReading(machine, now) === null
        ? 1
        : 0;
  return [...machines].sort((left, right) => {
    const leftReading = freshReading(left, now);
    const rightReading = freshReading(right, now);
    return (
      group(left) - group(right) ||
      (leftReading !== null && rightReading !== null
        ? loadPerProcessor(leftReading) - loadPerProcessor(rightReading)
        : 0) ||
      compareIdentity(left, right)
    );
  });
}

export function nextPick(
  machines: readonly Machine[],
  now: number,
): string | null {
  return (
    rankMachines(machines, now).find(
      (machine) =>
        freshReading(machine, now) !== null &&
        machine.providers.kind === "reported" &&
        machine.providers.providers.some(
          (provider) => provider.readiness.kind === "ready",
        ),
    )?.hostId ?? null
  );
}

export interface PlacementRequest {
  projectName: string;
  providerId: string;
  sources: ReadonlyMap<string, SourceObservation>;
}

function skip(
  machine: Machine,
  code: Skip["code"],
  label: string,
  reason: string,
): Skip {
  return { hostId: machine.hostId, name: machine.name, code, label, reason };
}

function ineligibility(
  machine: Machine,
  request: PlacementRequest,
  now: number,
): Skip | null {
  const source = request.sources.get(machine.hostId) ?? { kind: "missing" };
  if (source.kind === "missing") {
    return skip(
      machine,
      "no-project-source",
      `no source for ${request.projectName}`,
      `${request.projectName} has no source on this machine.`,
    );
  }
  if (source.kind === "failed") {
    return skip(
      machine,
      "project-source-unavailable",
      "source check failed",
      source.reason,
    );
  }
  if (machine.providers.kind === "unavailable") {
    return skip(
      machine,
      "provider-readiness-unknown",
      `${request.providerId} ${PROVIDER_LABELS["provider-readiness-unknown"]}`,
      machine.providers.reason,
    );
  }
  const provider = machine.providers.providers.find(
    (candidate) => candidate.providerId === request.providerId,
  );
  if (provider === undefined) {
    return skip(
      machine,
      "provider-not-offered",
      `${request.providerId} ${PROVIDER_LABELS["provider-not-offered"]}`,
      "Provider is not offered on this machine.",
    );
  }
  if (provider.readiness.kind === "not-ready") {
    return skip(
      machine,
      provider.readiness.code,
      `${provider.displayName} ${provider.readiness.label}`,
      provider.readiness.reason,
    );
  }
  if (freshReading(machine, now) === null) {
    return skip(
      machine,
      "load-unavailable",
      "load unavailable",
      machine.load.kind === "unavailable"
        ? machine.load.reason
        : "Load reading is older than the freshness window.",
    );
  }
  return null;
}

export function decidePlacement(
  machines: readonly Machine[],
  request: PlacementRequest,
  now: number,
): Placement {
  const skipped: Skip[] = [];
  let best: { machine: Machine; reading: FreshReading } | null = null;
  for (const machine of rankMachines(machines, now)) {
    if (machine.availability.kind !== "available") continue;
    const reason = ineligibility(machine, request, now);
    if (reason !== null) {
      skipped.push(reason);
      continue;
    }
    const reading = freshReading(machine, now);
    if (best === null && reading !== null) best = { machine, reading };
  }
  if (best === null) {
    return {
      kind: "stay-on-server",
      reason:
        "No connected machine is ready for this project and provider with a fresh load reading.",
      skipped,
    };
  }
  const value = loadPerProcessor(best.reading);
  return {
    kind: "chosen",
    machine: {
      hostId: best.machine.hostId,
      name: best.machine.name,
      loadPerProcessor: value,
      requestedAt: best.reading.requestedAt,
    },
    reason: `${best.machine.name} has the lowest load per processor (${value.toFixed(2)}).`,
    skipped,
  };
}
