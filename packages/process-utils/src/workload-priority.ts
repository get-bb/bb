import { setPriority } from "node:os";

export const AGENT_WORKLOAD_NICE = 10;

export function deprioritizeAgentWorkload(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    setPriority(pid, AGENT_WORKLOAD_NICE);
  } catch {}
}
