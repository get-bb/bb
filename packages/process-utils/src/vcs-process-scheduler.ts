import { AsyncLocalStorage } from "node:async_hooks";

export type VcsProcessPriority = "interactive" | "status" | "background";

export interface VcsProcessOptions {
  priority?: VcsProcessPriority;
  signal?: AbortSignal;
  slots?: number;
}

type Command = "git" | "gh";
type Waiter = {
  command: Command;
  priority: VcsProcessPriority;
  slots: number;
  queuedAt: number;
  signal: AbortSignal | undefined;
  grant: (release: () => void) => void;
  onAbort: () => void;
};

const ranks = { interactive: 0, status: 1, background: 2 };
const capacities = [6, 5, 4];
const agingMs = 15_000;

class VcsProcessScheduler {
  readonly priority = new AsyncLocalStorage<VcsProcessPriority>();
  readonly admitted = new AsyncLocalStorage<true>();
  private active = 0;
  private githubActive = 0;
  private readonly queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  acquire(command: Command, options: VcsProcessOptions): Promise<() => void> {
    const slots = options.slots ?? 1;
    if (
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > (command === "gh" ? 2 : 4)
    ) {
      return Promise.reject(new Error("Invalid VCS process slot count"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(this.abortError(options.signal));
    }
    return new Promise((grant, reject) => {
      const waiter: Waiter = {
        command,
        priority: options.priority ?? this.priority.getStore() ?? "status",
        slots,
        queuedAt: performance.now(),
        signal: options.signal,
        grant,
        onAbort: () => {
          const index = this.queue.indexOf(waiter);
          if (index === -1) return;
          this.queue.splice(index, 1);
          reject(this.abortError(options.signal));
          this.drain();
        },
      };
      this.queue.push(waiter);
      options.signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.drain();
    });
  }

  private abortError(signal: AbortSignal | undefined): Error {
    return Object.assign(
      new Error("The operation was aborted", { cause: signal?.reason }),
      {
        name: "AbortError",
        code: "ABORT_ERR",
      },
    );
  }

  private rank(waiter: Waiter): number {
    return Math.max(
      0,
      ranks[waiter.priority] -
        Math.floor((performance.now() - waiter.queuedAt) / agingMs),
    );
  }

  private drain(): void {
    clearTimeout(this.timer);
    this.queue.sort(
      (a, b) => this.rank(a) - this.rank(b) || a.queuedAt - b.queuedAt,
    );
    for (let index = 0; index < this.queue.length;) {
      const waiter = this.queue[index]!;
      if (waiter.command === "gh" && this.githubActive + waiter.slots > 2) {
        index += 1;
        continue;
      }
      if (this.active + waiter.slots > capacities[this.rank(waiter)]!) break;
      this.queue.splice(index, 1);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      this.active += waiter.slots;
      if (waiter.command === "gh") this.githubActive += waiter.slots;
      let released = false;
      waiter.grant(() => {
        if (released) return;
        released = true;
        this.active -= waiter.slots;
        if (waiter.command === "gh") this.githubActive -= waiter.slots;
        this.drain();
      });
    }
    if (this.queue.length > 0) {
      const delay = Math.min(
        ...this.queue.map(
          (waiter) =>
            agingMs - ((performance.now() - waiter.queuedAt) % agingMs),
        ),
      );
      this.timer = setTimeout(() => this.drain(), delay);
    }
  }
}

const registry = globalThis as typeof globalThis & {
  __bbVcsProcessScheduler?: VcsProcessScheduler;
};
const scheduler = (registry.__bbVcsProcessScheduler ??=
  new VcsProcessScheduler());

export function withVcsProcessPriority<T>(
  priority: VcsProcessPriority,
  operation: () => T,
): T {
  return scheduler.priority.run(priority, operation);
}

export async function runVcsProcess<T>(
  command: Command,
  operation: () => Promise<T>,
  options: VcsProcessOptions = {},
): Promise<T> {
  if (scheduler.admitted.getStore()) {
    options.signal?.throwIfAborted();
    return operation();
  }
  const release = await scheduler.acquire(command, options);
  try {
    options.signal?.throwIfAborted();
    return await scheduler.admitted.run(true, operation);
  } finally {
    release();
  }
}
