import { probeProcessStart } from "./process-start.js";

export interface TrackedProcess {
  pid: number;
  processGroup: boolean;
  label: string;
  startId: () => Promise<string | null>;
  exited: Promise<void>;
}

export type TrackProcess = (process: TrackedProcess) => void;

export function readChildStartId(
  pid: number,
  hasExited: () => boolean,
): Promise<string | null> {
  if (hasExited()) return Promise.resolve(null);
  return probeProcessStart(pid).then(
    (probe) =>
      probe.state === "running" && !hasExited() ? probe.startId : null,
    () => null,
  );
}

export function trackedChildProcess(
  child: {
    pid?: number | undefined;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    once(event: "exit", listener: () => void): unknown;
  },
  args: { processGroup: boolean; label: string },
): TrackedProcess | null {
  const pid = child.pid;
  if (pid === undefined) return null;
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  let startId: string | null = null;
  return {
    pid,
    processGroup: args.processGroup,
    label: args.label,
    startId: async () => {
      startId ??= await readChildStartId(pid, hasExited);
      return startId;
    },
    exited: hasExited()
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", () => resolve())),
  };
}
