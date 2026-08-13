import type { PluginContext } from "../context.js";
import {
  ACTION_TOOL_NAMES,
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

export const VERIFICATION_ACTION_SERVICE = "agentic.action.verification" as const;
export const BENCH_ACTION_SERVICE = "agentic.action.bench" as const;
export const FIRMWARE_ACTION_SERVICE = "agentic.action.firmware" as const;

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
  run(input: Parameters<VerificationAction["run"]>[0]): ReturnType<VerificationAction["run"]>;
  run(input: Parameters<VerificationAction["run"]>[0], scope: ActionInvocationScope): ReturnType<VerificationAction["run"]>;
}

export interface BenchAction {
  run(input: {
    pvId: string;
    tier: string;
    requirement?: string;
    target?: string;
  }): Promise<{ runId: string; threadId: string; status: "queued" | "running" }>;
}

export interface ScopedBenchAction extends BenchAction {
  run(input: Parameters<BenchAction["run"]>[0]): ReturnType<BenchAction["run"]>;
  run(input: Parameters<BenchAction["run"]>[0], scope: ActionInvocationScope): ReturnType<BenchAction["run"]>;
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
  materialize(input: Parameters<FirmwareAction["materialize"]>[0]): ReturnType<FirmwareAction["materialize"]>;
  materialize(input: Parameters<FirmwareAction["materialize"]>[0], scope: ActionInvocationScope): ReturnType<FirmwareAction["materialize"]>;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

export function assertActionBoundary(registry: AgentSurfaceCandidate): void {
  const allowed = sorted(ACTION_TOOL_ALLOWLIST);
  const canonical = sorted(
    Object.values(registry.tools)
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
  if (Object.hasOwn(registry.tools, "fs_sync_push")) {
    throw new Error("PROHIBITED_AGENT_PUSH_TOOL: fs_sync_push must never be registered");
  }
}

export function requireActionService<T>(ctx: PluginContext, key: string): T {
  return ctx.service<T>(key, () => {
    throw new Error(`ACTION_SERVICE_NOT_REGISTERED: ${key}`);
  });
}
