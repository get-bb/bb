import { readProcessIdentity } from "@bb/process-utils";

/**
 * What the operating system reports about a running process. `command` is its
 * full command line, or null when the OS does not expose it. `startedAt` is its
 * start time in epoch milliseconds, accurate to about a second on POSIX, or null
 * when it cannot be read.
 */
export interface ExperimentalProcessIdentity {
  command: string | null;
  startedAt: number | null;
}

/**
 * Reads a running process's command line and approximate start time, or null
 * when the process is gone or cannot be inspected, so a host entry can confirm
 * a recorded PID still belongs to the process it launched before signalling
 * it. Uses `ps` on POSIX and PowerShell CIM on Windows. Experimental: see
 * docs/api_to_audit.md.
 */
export function experimental_readProcessIdentity(
  pid: number,
): Promise<ExperimentalProcessIdentity | null> {
  return readProcessIdentity(pid);
}
