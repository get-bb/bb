import type {
  ForgeComputeClient,
  ForgeJobSnapshot,
  ForgeJobStatus,
} from "../../../lib/remote/types.js";

export type ForgeJobTerminal = "COMPLETED" | "FAILED" | "TIMEOUT";

export interface BenchJobScheduler {
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface BenchJobHint {
  jobId: string;
  status: ForgeJobStatus;
  eventCount: number;
}

export interface PollForgeJobOptions {
  scheduler: BenchJobScheduler;
  publishHint?(hint: BenchJobHint): void;
  initialBackoffMs?: number;
  maximumBackoffMs?: number;
  maximumConsecutiveErrors?: number;
}

const TERMINAL = new Set<ForgeJobTerminal>(["COMPLETED", "FAILED", "TIMEOUT"]);

function validateStatus(status: string): asserts status is ForgeJobStatus {
  if (status !== "RUNNING" && !TERMINAL.has(status as ForgeJobTerminal)) {
    throw new Error(`FORGE_JOB_UNKNOWN_STATE: ${status}`);
  }
}

export async function pollForgeJob(
  client: Pick<ForgeComputeClient, "getJobStatus">,
  jobId: string,
  signal: AbortSignal,
  options: PollForgeJobOptions,
): Promise<ForgeJobSnapshot> {
  const initialBackoffMs = options.initialBackoffMs ?? 500;
  const maximumBackoffMs = options.maximumBackoffMs ?? 8_000;
  const maximumConsecutiveErrors = options.maximumConsecutiveErrors ?? 4;
  let backoffMs = initialBackoffMs;
  let consecutiveErrors = 0;

  while (true) {
    signal.throwIfAborted();
    let snapshot: ForgeJobSnapshot;
    try {
      snapshot = await client.getJobStatus(jobId, 50, { signal });
      consecutiveErrors = 0;
    } catch (error) {
      signal.throwIfAborted();
      consecutiveErrors += 1;
      if (consecutiveErrors > maximumConsecutiveErrors) throw error;
      await options.scheduler.sleep(backoffMs, signal);
      backoffMs = Math.min(maximumBackoffMs, backoffMs * 2);
      continue;
    }
    validateStatus(snapshot.status);
    options.publishHint?.({
      jobId: snapshot.jobId,
      status: snapshot.status,
      eventCount: snapshot.eventCount,
    });
    if (snapshot.status !== "RUNNING") return snapshot;
    await options.scheduler.sleep(backoffMs, signal);
    backoffMs = Math.min(maximumBackoffMs, backoffMs * 2);
  }
}

export async function pollForgeJobs(
  client: Pick<ForgeComputeClient, "getJobStatus">,
  jobIds: readonly string[],
  signal: AbortSignal,
  options: PollForgeJobOptions,
): Promise<ForgeJobSnapshot[]> {
  return await Promise.all(jobIds.map((jobId) => pollForgeJob(client, jobId, signal, options)));
}

export interface BenchJobTask {
  run(signal: AbortSignal): Promise<void>;
}

export interface BenchJobQueue {
  take(signal: AbortSignal): Promise<BenchJobTask>;
}

export class InMemoryBenchJobQueue implements BenchJobQueue {
  readonly #tasks: BenchJobTask[] = [];
  readonly #waiters: Array<(task: BenchJobTask) => void> = [];

  enqueue(task: BenchJobTask): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter(task);
    else this.#tasks.push(task);
  }

  async take(signal: AbortSignal): Promise<BenchJobTask> {
    signal.throwIfAborted();
    const task = this.#tasks.shift();
    if (task) return task;
    return await new Promise<BenchJobTask>((resolve, reject) => {
      const waiter = (next: BenchJobTask) => {
        signal.removeEventListener("abort", abort);
        resolve(next);
      };
      const abort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(signal.reason);
      };
      this.#waiters.push(waiter);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

export async function runBenchJobService(
  queue: BenchJobQueue,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const task = await queue.take(signal);
      await task.run(signal);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
  }
}
