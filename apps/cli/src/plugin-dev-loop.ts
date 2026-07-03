/**
 * The `bb plugin dev` watch loop (plugin design §5.1 dev loop), separated
 * from the command wiring so the batching/ordering behavior is testable with
 * injected build/reload/log functions. The command feeds raw watcher events
 * into {@link PluginDevLoop.handleChange}; the loop debounces them into
 * change batches and runs one cycle per batch:
 *
 *   1. plugin declares `bb.app` → rebuild the frontend bundle (a build
 *      failure prints the error and skips the reload — the on-disk bundle is
 *      unchanged, and a broken source tree should not churn backend
 *      services; the next save retries);
 *   2. POST /plugins/reload?id=<id> — the server re-runs the backend factory,
 *      refreshes the bundle hash, and broadcasts `plugins-changed`, which
 *      drives both the contributions refetch and the live frontend reload in
 *      open pages.
 *
 * Cycles are serialized (a change during a running cycle starts a new
 * debounce window) and failures never exit the loop.
 */

const DEFAULT_DEBOUNCE_MS = 300;

/** Output directories a cycle must never retrigger on (dist/ is written by
 * the loop's own rebuild — watching it would loop forever). */
const IGNORED_SEGMENTS = new Set(["dist", "node_modules", ".git"]);

export function isIgnoredPluginDevPath(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]/)
    .some((segment) => IGNORED_SEGMENTS.has(segment));
}

export interface PluginDevLoopDeps {
  pluginId: string;
  /** Whether the manifest declares a `bb.app` frontend entry. */
  hasApp: boolean;
  buildApp: () => Promise<void>;
  /** Rejects with the server's error message on a failed reload. */
  reloadPlugin: () => Promise<void>;
  log: (line: string) => void;
  debounceMs?: number;
  now?: () => number;
}

export interface PluginDevLoop {
  /** Feed one watcher event (path relative to the plugin root). */
  handleChange: (relativePath: string) => void;
  /** Resolves when every started cycle has finished (test synchronization). */
  settled: () => Promise<void>;
  dispose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginDevLoop(deps: PluginDevLoopDeps): PluginDevLoop {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = deps.now ?? (() => Date.now());
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  // Cycles chain onto this tail — one at a time, in batch order.
  let queueTail: Promise<void> = Promise.resolve();

  async function runCycle(files: readonly string[]): Promise<void> {
    if (disposed) return;
    const parts = [`${files.length} file${files.length === 1 ? "" : "s"} changed`];
    if (deps.hasApp) {
      const startedAt = now();
      try {
        await deps.buildApp();
        parts.push(`rebuilt app in ${Math.max(0, Math.round(now() - startedAt))}ms`);
      } catch (error) {
        parts.push(`build failed: ${errorMessage(error)}`);
        deps.log(`${parts.join(" · ")} — fix and save to retry`);
        return;
      }
    }
    try {
      await deps.reloadPlugin();
      parts.push(`reloaded ${deps.pluginId}`);
    } catch (error) {
      parts.push(`reload failed: ${errorMessage(error)}`);
    }
    deps.log(parts.join(" · "));
  }

  function flush(): void {
    timer = null;
    if (pending.size === 0) return;
    const files = [...pending];
    pending.clear();
    queueTail = queueTail.then(() => runCycle(files));
  }

  return {
    handleChange(relativePath) {
      if (disposed || isIgnoredPluginDevPath(relativePath)) return;
      pending.add(relativePath);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    settled() {
      return queueTail;
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
