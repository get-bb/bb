const DEBOUNCE_MS = 300;
const IGNORED_SEGMENTS = new Set(["dist", "node_modules", ".git"]);
// bb-fork(windows): how long to wait before retrying a hot reload that was
// bb-fork(windows): held back by an open plugin form.
export const PLUGIN_DEV_DEFER_RETRY_MS = 3000;

export function isIgnoredPluginDevPath(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]/)
    .some((segment) => IGNORED_SEGMENTS.has(segment));
}

export interface PluginDevLoopTargets {
  hasApp: boolean;
  hasHost: boolean;
}

interface PluginDevLoopDeps {
  pluginId: string;
  targets: () => Promise<PluginDevLoopTargets>;
  buildApp: () => Promise<void>;
  buildHost: () => Promise<void>;
  reloadPlugin: () => Promise<void>;
  log: (line: string) => void;
  // bb-fork(windows): return a reason to hold the rebuild + reload while a user
  // bb-fork(windows): is still answering this plugin's form; null to proceed.
  deferReload?: () => string | null;
}

interface PluginDevLoop {
  handleChange: (relativePath: string) => void;
  settled: () => Promise<void>;
  dispose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginDevLoop(deps: PluginDevLoopDeps): PluginDevLoop {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let deferralNotified = false;
  let queueTail: Promise<void> = Promise.resolve();
  async function runCycle(files: readonly string[]): Promise<void> {
    if (disposed) return;
    // bb-fork(windows): a rebuild or reload would destroy an open plugin form
    // bb-fork(windows): (for example an AskUserQuestion card), so hold the whole
    // bb-fork(windows): cycle until the request is answered or expires.
    const deferReason = deps.deferReload?.() ?? null;
    if (deferReason !== null) {
      if (!deferralNotified) {
        deferralNotified = true;
        deps.log(
          `${files.length} file${files.length === 1 ? "" : "s"} changed · reload deferred: ${deferReason}`,
        );
      }
      for (const file of files) pending.add(file);
      if (timer === null) timer = setTimeout(flush, PLUGIN_DEV_DEFER_RETRY_MS);
      return;
    }
    deferralNotified = false;
    const parts = [
      `${files.length} file${files.length === 1 ? "" : "s"} changed`,
    ];
    let targets: PluginDevLoopTargets;
    try {
      targets = await deps.targets();
    } catch (error) {
      parts.push(`manifest read failed: ${errorMessage(error)}`);
      deps.log(`${parts.join(" · ")} — fix and save to retry`);
      return;
    }
    if (targets.hasApp) {
      const startedAt = Date.now();
      try {
        await deps.buildApp();
        parts.push(
          `rebuilt app in ${Math.max(0, Math.round(Date.now() - startedAt))}ms`,
        );
      } catch (error) {
        parts.push(`build failed: ${errorMessage(error)}`);
        deps.log(`${parts.join(" · ")} — fix and save to retry`);
        return;
      }
    }
    if (targets.hasHost) {
      const startedAt = Date.now();
      try {
        await deps.buildHost();
        parts.push(
          `rebuilt host in ${Math.max(0, Math.round(Date.now() - startedAt))}ms`,
        );
      } catch (error) {
        parts.push(`host build failed: ${errorMessage(error)}`);
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
      timer = setTimeout(flush, DEBOUNCE_MS);
    },
    settled: () => queueTail,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
