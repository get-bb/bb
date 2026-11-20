import type { BbAppProcessExit } from "./bb-process.js";
import type { SettledServerProbeResult } from "./server-probe.js";

export type OwnedRuntimeStartupResult =
  | ProcessExitedStartupResult
  | ServerProbeStartupResult;

interface ProcessExitedStartupResult {
  exit: BbAppProcessExit;
  kind: "process-exited";
}

interface ServerProbeStartupResult {
  kind: "server-probe";
  result: SettledServerProbeResult;
}

interface WaitForOwnedRuntimeStartupArgs {
  exit: Promise<BbAppProcessExit>;
  onSlowStart(): void;
  slowStartNoticeMs: number;
  waitForServer(signal: AbortSignal): Promise<SettledServerProbeResult>;
}

export async function waitForOwnedRuntimeStartup(
  args: WaitForOwnedRuntimeStartupArgs,
): Promise<OwnedRuntimeStartupResult> {
  const probe = new AbortController();
  const slowStartNotice = setTimeout(args.onSlowStart, args.slowStartNoticeMs);
  try {
    return await Promise.race<OwnedRuntimeStartupResult>([
      args
        .waitForServer(probe.signal)
        .then((result) => ({ kind: "server-probe", result })),
      args.exit.then((exit) => ({ exit, kind: "process-exited" })),
    ]);
  } finally {
    clearTimeout(slowStartNotice);
    probe.abort();
  }
}
