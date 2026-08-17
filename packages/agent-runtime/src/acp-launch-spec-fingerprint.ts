import { createHash } from "node:crypto";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";
import type { AgentRuntimeBridgeLaunch } from "./types.js";

type StableJsonValue =
  | string
  | number
  | boolean
  | null
  | StableJsonValue[]
  | { [key: string]: StableJsonValue };

function toStableJsonValue(value: unknown): StableJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, toStableJsonValue(entryValue)]),
    );
  }
  throw new Error(`Cannot fingerprint value of type ${typeof value}.`);
}

function fingerprintStableJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(toStableJsonValue(value)))
    .digest("hex")
    .slice(0, 16);
}

export function fingerprintAcpLaunchSpec(
  spec: HostDaemonAcpLaunchSpec,
): string {
  return fingerprintStableJson(normalizeHostDaemonAcpLaunchSpec(spec));
}

/**
 * Process-key part for a bridge launch: which binary the adapter spawns, plus
 * the declaration facts it is built from and then keeps for the life of that
 * process (the capabilities it enforces). The capabilities come from the
 * plugin's declaration, not from its bundle, so editing a declaration changes
 * them while the artifact hash stays put — without them in the key the next
 * thread reuses an adapter built from the superseded declaration.
 */
export function bridgeLaunchProcessKey(
  bridgeLaunch: AgentRuntimeBridgeLaunch,
): string {
  const source =
    bridgeLaunch.source.kind === "artifact"
      ? bridgeLaunch.source.digest.slice(0, 16)
      : `bundled:${bridgeLaunch.source.id}`;
  return `${source}.${fingerprintStableJson({
    capabilities: bridgeLaunch.capabilities,
  })}`;
}
