import { AsyncLocalStorage } from "node:async_hooks";
import { getHost, getLatestSessionForHost, type DbConnection } from "@bb/db";
import type {
  DeviceSetupSource,
  DeviceSetupProperties,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { readPrimaryHostIdFromDataDir } from "../hosts/primary-host.js";

type Deps = Pick<AppDeps, "db" | "telemetry" | "config">;
const sourceContext = new AsyncLocalStorage<DeviceSetupSource>();
const enrollments = new WeakMap<
  DbConnection,
  Map<
    string,
    {
      source: DeviceSetupSource;
      credentials: boolean;
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
  properties: DeviceSetupProperties,
): void {
  if (deps.telemetry.isEnabled())
    deps.telemetry.capture({ name: "device_setup", properties });
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
    credentials: false,
    ready: false,
    result: null,
  });
  emit(deps, {
    target: "additional_machine",
    action: "enrollment_requested",
    outcome: "started",
    source,
    error_category: null,
  });
}

export function recordMachineCredentials(deps: Deps, hostId: string): void {
  if (getLatestSessionForHost(deps.db, { hostId }) !== null) return;
  const states = pending(deps);
  let state = states.get(hostId);
  if (!state) {
    const primary = readPrimaryHostIdFromDataDir({
      dataDir: deps.config.dataDir,
    });
    if (primary === null || hostId === primary) return;
    state = {
      source: "unknown",
      credentials: false,
      ready: false,
      result: null,
    };
    states.set(hostId, state);
  }
  if (state.credentials) return;
  state.credentials = true;
  emit(deps, {
    target: "additional_machine",
    action: "credentials_accepted",
    outcome: "succeeded",
    source: state.source,
    error_category: null,
  });
}

export function recordMachineReady(deps: Deps, hostId: string): void {
  const current = getHost(deps.db, hostId);
  if (!current || current.destroyedAt !== null || current.phase === "removing")
    return;
  const states = pending(deps);
  let state = states.get(hostId);
  if (!state) {
    const host = getHost(deps.db, hostId);
    const primary = readPrimaryHostIdFromDataDir({
      dataDir: deps.config.dataDir,
    });
    if (
      !host ||
      host.lastSeenAt !== null ||
      primary === null ||
      primary === hostId
    )
      return;
    state = {
      source: "unknown",
      credentials: false,
      ready: false,
      result: null,
    };
    states.set(hostId, state);
  }
  if (state.ready) return;
  state.ready = true;
  emit(deps, {
    target: "additional_machine",
    action: "machine_ready",
    outcome: "succeeded",
    source: state.source,
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
    target: "additional_machine",
    action: "setup_result",
    outcome,
    source: state.source,
    error_category: outcome === "cancelled" ? null : "enrollment",
  });
  if (outcome === "cancelled" || getHost(deps.db, hostId)?.destroyedAt != null)
    pending(deps).delete(hostId);
}
