import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type {
  HostDaemonRpcCommand,
  TurnSubmitTrace,
  TurnSubmitTraceSpanName,
} from "@bb/host-daemon-contract";
import { roundDurationMs } from "@bb/process-utils";

interface TurnSubmitTraceRecorder {
  receivedAt: number;
  trace: TurnSubmitTrace;
}

const currentRecorder = new AsyncLocalStorage<TurnSubmitTraceRecorder>();

export function runWithTurnSubmitTrace<T>(
  command: HostDaemonRpcCommand,
  work: () => Promise<T>,
): Promise<T> {
  if (command.type !== "turn.submit") {
    return work();
  }
  return currentRecorder.run(
    { receivedAt: performance.now(), trace: { spans: [] } },
    work,
  );
}

export function markTurnSubmitTraceSpan(name: TurnSubmitTraceSpanName): void {
  const recorder = currentRecorder.getStore();
  if (recorder === undefined) {
    return;
  }
  recorder.trace.spans.push({
    name,
    atMs: roundDurationMs(performance.now() - recorder.receivedAt),
  });
}

export function currentTurnSubmitTrace(): TurnSubmitTrace {
  return currentRecorder.getStore()?.trace ?? { spans: [] };
}
