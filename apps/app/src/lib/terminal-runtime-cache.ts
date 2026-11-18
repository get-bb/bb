export const MAX_PARKED_TERMINAL_RUNTIMES = 8;

export interface ParkedTerminalRuntime {
  dispose(): void;
}

const parkedTerminalRuntimes = new Map<string, ParkedTerminalRuntime>();

export function takeParkedTerminalRuntime(
  terminalId: string,
): ParkedTerminalRuntime | null {
  const runtime = parkedTerminalRuntimes.get(terminalId);
  if (runtime === undefined) {
    return null;
  }
  parkedTerminalRuntimes.delete(terminalId);
  return runtime;
}

export function parkTerminalRuntime(
  terminalId: string,
  runtime: ParkedTerminalRuntime,
): void {
  const existing = parkedTerminalRuntimes.get(terminalId);
  parkedTerminalRuntimes.delete(terminalId);
  if (existing !== undefined && existing !== runtime) {
    existing.dispose();
  }
  parkedTerminalRuntimes.set(terminalId, runtime);
  while (parkedTerminalRuntimes.size > MAX_PARKED_TERMINAL_RUNTIMES) {
    const oldest = parkedTerminalRuntimes.entries().next().value;
    if (oldest === undefined) {
      return;
    }
    parkedTerminalRuntimes.delete(oldest[0]);
    oldest[1].dispose();
  }
}

export function evictTerminalRuntime(terminalId: string): void {
  const runtime = parkedTerminalRuntimes.get(terminalId);
  if (runtime === undefined) {
    return;
  }
  parkedTerminalRuntimes.delete(terminalId);
  runtime.dispose();
}
