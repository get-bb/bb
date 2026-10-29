import type { ChildProcess } from "node:child_process";
import { supportsProcessGroups } from "./process-group.js";
import { trackedChildProcess, type TrackProcess } from "./tracked-process.js";

export interface ProcessOwner {
  trackProcess: TrackProcess;
}

const HOST_PROCESS_OWNER = Symbol.for("bb.process-utils.host-process-owner");

function boundHostTracker(): TrackProcess | null {
  const tracker: unknown = Reflect.get(globalThis, HOST_PROCESS_OWNER);
  return typeof tracker === "function"
    ? (process) => Reflect.apply(tracker, undefined, [process])
    : null;
}

export const hostProcessOwner: ProcessOwner = {
  trackProcess: (process) => boundHostTracker()?.(process),
};

export function bindHostProcessOwner(trackProcess: TrackProcess | null): void {
  Reflect.set(globalThis, HOST_PROCESS_OWNER, trackProcess ?? undefined);
}

let currentOwner: ProcessOwner = hostProcessOwner;

export function withProcessOwner<T>(owner: ProcessOwner, start: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return start();
  } finally {
    currentOwner = previous;
  }
}

export function recordOwnedProcess(
  child: ChildProcess,
  args: { command: string; detached: boolean | undefined },
  owner: ProcessOwner = currentOwner,
): void {
  const tracked = trackedChildProcess(child, {
    processGroup: args.detached === true && supportsProcessGroups(),
    label: args.command,
  });
  if (tracked !== null) owner.trackProcess(tracked);
}
