import type { PluginContext } from "../context.js";
import {
  ACTION_TOOL_NAMES,
  AGENT_TOOL_NAMES,
  type ActionToolName,
  type AgentSurfaceCandidate,
} from "./registry.js";

export type { ActionToolName } from "./registry.js";

export const ACTION_TOOL_ALLOWLIST = [
  "fs_verification_run",
  "fs_bench_run",
  "fs_firmware_materialize",
  "fs_hw_extract",
  "fs_build",
  "fs_flash",
  "fs_serial",
  "fs_probe",
] as const satisfies readonly ActionToolName[];

export type AllowedActionToolName = (typeof ACTION_TOOL_ALLOWLIST)[number];

export const VERIFICATION_ACTION_SERVICE =
  "agentic.action.verification" as const;
export const BENCH_ACTION_SERVICE = "agentic.action.bench" as const;
export const FIRMWARE_ACTION_SERVICE = "agentic.action.firmware" as const;

export type ActionFailureKind =
  | "precondition"
  | "permission"
  | "dispatch_ambiguous"
  | "failed";

export class ActionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: ActionFailureKind,
    readonly ids: Readonly<{
      runId?: string;
      threadId?: string;
      jobId?: string;
    }> = {},
  ) {
    super(message);
    this.name = "ActionServiceError";
  }
}

export interface ActionInvocationScope {
  projectId: string;
  threadId: string;
  signal: AbortSignal;
}

export interface VerificationAction {
  run(input: {
    requirement: string;
    tier?: string;
    check?: string;
  }): Promise<{ jobId: string; runId?: string }>;
}

export interface ScopedVerificationAction extends VerificationAction {
  run(
    input: Parameters<VerificationAction["run"]>[0],
  ): ReturnType<VerificationAction["run"]>;
  run(
    input: Parameters<VerificationAction["run"]>[0],
    scope: ActionInvocationScope,
  ): ReturnType<VerificationAction["run"]>;
}

export interface BenchAction {
  run(input: {
    pvId: string;
    tier: string;
    requirement?: string;
    target?: string;
  }): Promise<{
    runId: string;
    threadId: string;
    status: "queued" | "running";
  }>;
}

export interface ScopedBenchAction extends BenchAction {
  run(input: Parameters<BenchAction["run"]>[0]): ReturnType<BenchAction["run"]>;
  run(
    input: Parameters<BenchAction["run"]>[0],
    scope: ActionInvocationScope,
  ): ReturnType<BenchAction["run"]>;
}

export interface FirmwareAction {
  materialize(input: {
    pvId: string;
    scanId?: string;
    mode: "manifest" | "hydrate" | "hydrate_all";
    paths?: string[];
  }): Promise<{
    pvId: string;
    source: "standalone_unpack" | "api";
    hydrated: number;
    remaining: number;
    errors: number;
  }>;
}

export interface ScopedFirmwareAction extends FirmwareAction {
  materialize(
    input: Parameters<FirmwareAction["materialize"]>[0],
  ): ReturnType<FirmwareAction["materialize"]>;
  materialize(
    input: Parameters<FirmwareAction["materialize"]>[0],
    scope: ActionInvocationScope,
  ): ReturnType<FirmwareAction["materialize"]>;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

export function assertActionBoundary(
  registry: AgentSurfaceCandidate,
  registeredToolNames?: readonly string[],
): void {
  const entries = Object.entries(registry.tools);
  const ownToolKeys = Object.getOwnPropertyNames(registry.tools);
  if (
    "fs_sync_push" in registry.tools ||
    ownToolKeys.some((key) => registry.tools[key].name === "fs_sync_push")
  ) {
    throw new Error(
      "PROHIBITED_AGENT_PUSH_TOOL: fs_sync_push must never be registered",
    );
  }
  const splitIdentities = entries
    .filter(([key, tool]) => key !== tool.name)
    .map(([key, tool]) => `${key}=>${tool.name}`);
  if (splitIdentities.length > 0) {
    throw new Error(
      `AGENT_TOOL_REGISTRY_DRIFT: registry keys must match tool.name: ${sorted(splitIdentities).join(", ")}`,
    );
  }
  const allowed = sorted(ACTION_TOOL_ALLOWLIST);
  const canonical = sorted(
    entries
      .map(([, tool]) => tool)
      .filter((tool) => tool.class === "action")
      .map((tool) => tool.name),
  );
  if (JSON.stringify(allowed) !== JSON.stringify(canonical)) {
    throw new Error(
      "ACTION_ALLOWLIST_AMENDMENT_REQUIRED: adding, removing, or reclassifying an action requires a recorded AMENDMENTS.md decision",
    );
  }
  if (ACTION_TOOL_NAMES.length !== ACTION_TOOL_ALLOWLIST.length) {
    throw new Error("ACTION_ALLOWLIST_COMPILE_RUNTIME_DRIFT");
  }
  if (registeredToolNames === undefined) return;

  const known = new Set<string>(AGENT_TOOL_NAMES);
  const registered = new Set(registeredToolNames);
  if (registered.has("fs_sync_push")) {
    throw new Error(
      "PROHIBITED_AGENT_PUSH_TOOL: fs_sync_push must never be registered",
    );
  }
  const unknown = registeredToolNames.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `AGENT_TOOL_REGISTRY_DRIFT: registered tools are absent from the closed registry: ${sorted(unknown).join(", ")}`,
    );
  }
  const serverActions = Object.values(registry.tools)
    .filter((tool) => tool.class === "action" && tool.server !== "none")
    .map((tool) => tool.name);
  const registeredServerActions = registeredToolNames.filter((name) =>
    serverActions.some((serverAction) => serverAction === name),
  );
  if (
    JSON.stringify(sorted(registeredServerActions)) !==
    JSON.stringify(sorted(serverActions))
  ) {
    throw new Error(
      "ACTION_REGISTRATION_DRIFT: server-backed registry actions must equal the registered action-tool set",
    );
  }
}

export function requireActionService<T>(ctx: PluginContext, key: string): T {
  return ctx.service<T>(key, () => {
    throw new Error(`ACTION_SERVICE_NOT_REGISTERED: ${key}`);
  });
}
