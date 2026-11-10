import { randomUUID } from "node:crypto";

export const FINISHED_JOB_RETENTION_MS = 10 * 60_000;

export interface JobRunContext<TJob> {
  job: TJob;
  set(job: TJob): void;
  signal: AbortSignal;
}

export interface JobOutcome<TJob> {
  job: TJob;
  error: unknown;
}

export interface JobRegistry<TJob extends { id: string }> {
  start(args: {
    key: string;
    lane: string;
    create: (id: string) => TJob;
    run: (context: JobRunContext<TJob>) => Promise<TJob>;
  }): TJob;
  get(id: string): TJob | undefined;
  list(): TJob[];
  settled(id: string): Promise<JobOutcome<TJob>> | undefined;
  cancel(
    id: string,
    next: { queued: (job: TJob) => TJob; running: (job: TJob) => TJob },
  ): TJob | undefined;
}

interface JobEntry<TJob> {
  job: TJob;
  key: string;
  lane: string;
  run: (context: JobRunContext<TJob>) => Promise<TJob>;
  controller: AbortController;
  started: boolean;
  finishedAt: number | null;
  settled: Promise<JobOutcome<TJob>>;
  settle: (outcome: JobOutcome<TJob>) => void;
}

export function createJobRegistry<TJob extends { id: string }>(options: {
  isActive: (job: TJob) => boolean;
  fail: (job: TJob, error: unknown, signal: AbortSignal) => TJob;
  notifyChanged: (job: TJob) => void;
  now?: () => number;
}): JobRegistry<TJob> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, JobEntry<TJob>>();
  const busyLanes = new Set<string>();

  function pruneFinished(): void {
    const cutoff = now() - FINISHED_JOB_RETENTION_MS;
    for (const [id, entry] of entries) {
      if (entry.finishedAt !== null && entry.finishedAt <= cutoff) {
        entries.delete(id);
      }
    }
  }

  function set(entry: JobEntry<TJob>, job: TJob, error: unknown = null): void {
    if (entry.finishedAt !== null) return;
    entry.job = job;
    if (!options.isActive(job)) {
      entry.finishedAt = now();
      entry.settle({ job, error });
    }
    options.notifyChanged(job);
  }

  function pump(lane: string): void {
    if (busyLanes.has(lane)) return;
    const next = [...entries.values()].find(
      (entry) =>
        entry.lane === lane && !entry.started && entry.finishedAt === null,
    );
    if (next === undefined) return;
    next.started = true;
    busyLanes.add(lane);
    const { signal } = next.controller;
    let work: Promise<TJob>;
    try {
      work = next.run({ job: next.job, set: (job) => set(next, job), signal });
    } catch (error) {
      work = Promise.reject(error);
    }
    void work
      .then(
        (job) => set(next, job),
        (error: unknown) =>
          set(next, options.fail(next.job, error, signal), error),
      )
      .finally(() => {
        busyLanes.delete(lane);
        pump(lane);
      });
  }

  return {
    start({ key, lane, create, run }) {
      pruneFinished();
      for (const entry of entries.values()) {
        if (entry.key === key && entry.finishedAt === null) return entry.job;
      }
      let settle: (outcome: JobOutcome<TJob>) => void = () => {};
      const settled = new Promise<JobOutcome<TJob>>((resolve) => {
        settle = resolve;
      });
      const job = create(randomUUID());
      const entry: JobEntry<TJob> = {
        job,
        key,
        lane,
        run,
        controller: new AbortController(),
        started: false,
        finishedAt: null,
        settled,
        settle,
      };
      entries.set(job.id, entry);
      options.notifyChanged(job);
      pump(lane);
      return entry.job;
    },
    get(id) {
      pruneFinished();
      return entries.get(id)?.job;
    },
    list() {
      pruneFinished();
      return [...entries.values()].map((entry) => entry.job);
    },
    settled: (id) => entries.get(id)?.settled,
    cancel(id, next) {
      const entry = entries.get(id);
      if (entry === undefined) return undefined;
      if (entry.finishedAt !== null) return entry.job;
      entry.controller.abort();
      set(entry, entry.started ? next.running(entry.job) : next.queued(entry.job));
      return entry.job;
    },
  };
}
