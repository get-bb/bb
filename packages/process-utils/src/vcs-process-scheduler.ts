import { AsyncLocalStorage } from "node:async_hooks";
import { availableParallelism } from "node:os";

export type VcsProcessPriority = "interactive" | "status" | "background";

export interface VcsProcessOptions {
  priority?: VcsProcessPriority;
  signal?: AbortSignal;
  slots?: number;
}

type Command = "git" | "gh";
type Pool = "local" | "network";
type Waiter = {
  command: Command;
  pool: Pool;
  priority: VcsProcessPriority;
  slots: number;
  queuedAt: number;
  signal: AbortSignal | undefined;
  grant: (release: () => void) => void;
  onAbort: () => void;
};

const ranks = { interactive: 0, status: 1, background: 2 };

export function localProcessCapacities(parallelism: number): number[] {
  const total = Math.min(6, Math.max(4, parallelism - 2));
  return [total, total - 1, total - 2];
}

const capacities: Record<Pool, readonly number[]> = {
  local: localProcessCapacities(availableParallelism()),
  network: [4, 3, 2],
};
const githubCapacity = 2;
const agingMs = 15_000;
const networkGitSubcommands = new Set([
  "fetch",
  "pull",
  "push",
  "clone",
  "ls-remote",
]);
const gitGlobalOptionsWithValue = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

export function isNetworkGitCommand(args: readonly string[]): boolean {
  let index = 0;
  while (index < args.length && args[index]!.startsWith("-")) {
    index += gitGlobalOptionsWithValue.has(args[index]!) ? 2 : 1;
  }
  const subcommand = args[index];
  if (subcommand === undefined) return false;
  if (networkGitSubcommands.has(subcommand)) return true;
  const action = args.slice(index + 1).find((arg) => !arg.startsWith("-"));
  return (
    (subcommand === "submodule" || subcommand === "remote") &&
    action === "update"
  );
}

class VcsProcessScheduler {
  readonly priority = new AsyncLocalStorage<VcsProcessPriority>();
  readonly admitted = new AsyncLocalStorage<true>();
  private readonly active: Record<Pool, number> = { local: 0, network: 0 };
  private githubActive = 0;
  private readonly queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  acquire(
    command: Command,
    args: readonly string[],
    options: VcsProcessOptions,
  ): Promise<() => void> {
    const pool: Pool =
      command === "gh" || isNetworkGitCommand(args) ? "network" : "local";
    const slots = options.slots ?? 1;
    if (
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > capacities[pool][ranks.background]!
    ) {
      return Promise.reject(new Error("Invalid VCS process slot count"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(this.abortError(options.signal));
    }
    return new Promise((grant, reject) => {
      const waiter: Waiter = {
        command,
        pool,
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
    const blocked = new Set<Pool>();
    for (let index = 0; index < this.queue.length; ) {
      const waiter = this.queue[index]!;
      if (
        blocked.has(waiter.pool) ||
        (waiter.command === "gh" &&
          this.githubActive + waiter.slots > githubCapacity)
      ) {
        index += 1;
        continue;
      }
      if (
        this.active[waiter.pool] + waiter.slots >
        capacities[waiter.pool][this.rank(waiter)]!
      ) {
        blocked.add(waiter.pool);
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      this.active[waiter.pool] += waiter.slots;
      if (waiter.command === "gh") this.githubActive += waiter.slots;
      let released = false;
      waiter.grant(() => {
        if (released) return;
        released = true;
        this.active[waiter.pool] -= waiter.slots;
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
  args: readonly string[],
  operation: () => Promise<T>,
  options: VcsProcessOptions = {},
): Promise<T> {
  if (scheduler.admitted.getStore()) {
    options.signal?.throwIfAborted();
    return operation();
  }
  const release = await scheduler.acquire(command, args, options);
  try {
    options.signal?.throwIfAborted();
    return await scheduler.admitted.run(true, operation);
  } finally {
    release();
  }
}
