import { deviceTelemetryContext } from "@bb/server-contract";
import { AsyncLocalStorage } from "node:async_hooks";
import { getHost, getLatestSessionForHost, type DbConnection } from "@bb/db";
import type {
  DeviceSetupSource,
  DeviceOperationProperties,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";

type Deps = Pick<AppDeps, "db" | "telemetry" | "config">;
const sourceContext = new AsyncLocalStorage<DeviceSetupSource>();
const enrollments = new WeakMap<
  DbConnection,
  Map<
    string,
    {
      source: DeviceSetupSource;
      ready: boolean;
      result: "failed" | "cancelled" | "unknown" | null;
    }
  >
>();

export function withDeviceSetupSource<T>(
  source: DeviceSetupSource,
  run: () => T,
): T {
  return sourceContext.run(source, run);
}

function pending(deps: Pick<Deps, "db">) {
  let states = enrollments.get(deps.db);
  if (!states) {
    states = new Map();
    enrollments.set(deps.db, states);
  }
  return states;
}

function emit(
  deps: Pick<Deps, "telemetry">,
  properties: DeviceOperationProperties,
): void {
  if (deps.telemetry.isEnabled())
    deps.telemetry.capture({ name: "onboarding_operation", properties });
}

export function beginMachineEnrollment(deps: Deps, hostId: string): void {
  const states = pending(deps);
  if (
    states.has(hostId) ||
    getHost(deps.db, hostId)?.lastSeenAt != null ||
    getLatestSessionForHost(deps.db, { hostId }) !== null
  )
    return;
  const source = sourceContext.getStore() ?? "unknown";
  states.set(hostId, {
    source,
    ready: false,
    result: null,
  });
  emit(deps, {
    step: "devices",
    resource_type: "device",
    resource_id: "additional_machine",
    operation: "enroll",
    outcome: "started",
    ...deviceTelemetryContext(source),
    error_category: null,
  });
}

export function recordMachineReady(deps: Deps, hostId: string): void {
  const current = getHost(deps.db, hostId);
  if (!current || current.destroyedAt !== null || current.phase === "removing")
    return;
  const states = pending(deps);
  const state = states.get(hostId);
  if (!state || state.ready) return;
  state.ready = true;
  emit(deps, {
    step: "devices",
    resource_type: "device",
    resource_id: "additional_machine",
    operation: "enroll",
    outcome: "succeeded",
    ...deviceTelemetryContext(state.source),
    error_category: null,
  });
}

export function recordMachineSetupResult(
  deps: Deps,
  hostId: string,
  outcome: "failed" | "cancelled" | "unknown",
): void {
  const state = pending(deps).get(hostId);
  if (
    !state ||
    state.ready ||
    state.result === outcome ||
    state.result === "failed" ||
    state.result === "cancelled"
  )
    return;
  state.result = outcome;
  emit(deps, {
    step: "devices",
    resource_type: "device",
    resource_id: "additional_machine",
    operation: "enroll",
    outcome,
    ...deviceTelemetryContext(state.source),
    error_category: outcome === "cancelled" ? null : "enrollment",
  });
  if (outcome === "cancelled" || getHost(deps.db, hostId)?.destroyedAt != null)
    pending(deps).delete(hostId);
}
