import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { setPriority } from "node:os";
import { join } from "node:path";

export const AGENT_WORKLOAD_NICE = 10;

const AGENT_CPU_PRIORITY_FILE_NAME = "agent-cpu-priority.json";

let agentWorkloadsLowered = false;

export function setAgentWorkloadsLowered(lowered: boolean): void {
  agentWorkloadsLowered = lowered;
}

export function deprioritizeAgentWorkload(pid: number | undefined): void {
  if (!agentWorkloadsLowered || pid === undefined) return;
  try {
    setPriority(pid, AGENT_WORKLOAD_NICE);
  } catch {}
}

export function agentCpuPriorityFilePath(dataDir: string): string {
  return join(dataDir, AGENT_CPU_PRIORITY_FILE_NAME);
}

export function readAgentCpuPriority(dataDir: string): boolean {
  try {
    const value: unknown = JSON.parse(
      readFileSync(agentCpuPriorityFilePath(dataDir), "utf8"),
    );
    return (
      typeof value === "object" &&
      value !== null &&
      "enabled" in value &&
      value.enabled === true
    );
  } catch {
    return false;
  }
}

export function writeAgentCpuPriority(dataDir: string, enabled: boolean): void {
  const path = agentCpuPriorityFilePath(dataDir);
  const tempPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify({ enabled })}\n`, {
      mode: 0o600,
    });
    renameSync(tempPath, path);
  } catch {
    rmSync(tempPath, { force: true });
  }
}
