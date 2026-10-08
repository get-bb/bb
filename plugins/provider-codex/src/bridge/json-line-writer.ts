import type { Writable } from "node:stream";

const WRITE_CHUNK_BYTES = 64 * 1024;
const MAX_QUEUED_BYTES = 256 * 1024 * 1024;

interface JsonLineWriterOptions {
  stream: Writable;
  onError(error: Error): void;
  onPressureChange?(paused: boolean): void;
  maxQueuedBytes?: number;
  stallTimeoutMs?: number;
}

export function createJsonLineWriter({
  stream,
  onError,
  onPressureChange,
  maxQueuedBytes = MAX_QUEUED_BYTES,
  stallTimeoutMs = 30_000,
}: JsonLineWriterOptions) {
  const queue: Buffer[] = [];
  const waiters: { resolve(): void; reject(error: Error): void }[] = [];
  let retainedBytes = 0;
  let offset = 0;
  let writing = false;
  let needsDrain = false;
  let failure: Error | null = null;
  let stallTimer: NodeJS.Timeout | null = null;

  function clearStallTimer(): void {
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = null;
  }

  function armStallTimer(): void {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      abort(new Error(`JSON output stalled for ${stallTimeoutMs}ms`));
    }, stallTimeoutMs);
    stallTimer.unref?.();
  }

  function abort(error: Error): void {
    if (failure !== null) return;
    failure = error;
    clearStallTimer();
    queue.length = 0;
    retainedBytes = 0;
    offset = 0;
    stream.off("drain", drained);
    for (const waiter of waiters.splice(0)) waiter.reject(error);
    onError(error);
  }

  function pump(): void {
    if (failure !== null || writing || needsDrain) return;
    const line = queue[0];
    if (line === undefined) {
      clearStallTimer();
      onPressureChange?.(false);
      for (const waiter of waiters.splice(0)) waiter.resolve();
      return;
    }
    const end = Math.min(offset + WRITE_CHUNK_BYTES, line.length);
    writing = true;
    try {
      needsDrain = !stream.write(line.subarray(offset, end), (error) => {
        queueMicrotask(() => {
          if (failure !== null) return;
          if (error) {
            abort(error);
            return;
          }
          writing = false;
          armStallTimer();
          offset = end;
          if (offset === line.length) {
            queue.shift();
            retainedBytes -= line.length;
            offset = 0;
          }
          pump();
        });
      });
    } catch (error) {
      abort(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function drained(): void {
    needsDrain = false;
    pump();
  }

  stream.on("error", abort);
  stream.on("drain", drained);
  stream.once("close", () => abort(new Error("JSON output stream closed")));

  return {
    write(line: string): void {
      if (failure !== null) return;
      const bytes = Buffer.byteLength(line);
      if (bytes > maxQueuedBytes - retainedBytes) {
        abort(new Error(`JSON output queue exceeded ${maxQueuedBytes} bytes`));
        return;
      }
      if (stream.destroyed || !stream.writable) {
        abort(new Error("JSON output stream is not writable"));
        return;
      }
      queue.push(Buffer.from(line));
      retainedBytes += bytes;
      if (queue.length === 1) {
        if (stallTimer === null) armStallTimer();
        onPressureChange?.(true);
      }
      pump();
    },
    flush(): Promise<void> {
      if (failure !== null) return Promise.reject(failure);
      if (queue.length === 0 && !needsDrain) return Promise.resolve();
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    abort,
  };
}
