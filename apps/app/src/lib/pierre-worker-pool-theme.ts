import { useEffect } from "react";
import { registerCustomTheme } from "@pierre/diffs";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { stampRegisteredThemeName } from "@bb/domain";
import {
  getResolvedCodeTheme,
  useResolvedCodeTheme,
  useResolvedCodeThemePair,
} from "@/lib/code-theme";

const registeredFileNames = new Set<string>();

function registerResolvedCodeThemeFiles(): void {
  const resolved = getResolvedCodeTheme();
  for (const [name, theme] of Object.entries(resolved.files)) {
    if (registeredFileNames.has(name)) continue;
    registeredFileNames.add(name);
    const stamped = stampRegisteredThemeName(name, theme);
    registerCustomTheme(name, () => Promise.resolve(stamped));
  }
}

export interface CodeThemePair {
  dark: string;
  light: string;
}

/**
 * The theme pair each pool instance currently renders with. Pierre keeps its
 * render options private, and `pool.setRenderOptions` initializes the pool
 * (spawning every worker plus a main-thread highlighter) before it compares
 * options, so the sync must know on its own when a call would be a no-op.
 */
const appliedThemeByPool = new WeakMap<WorkerPoolManager, CodeThemePair>();

export function areCodeThemePairsEqual(
  left: CodeThemePair,
  right: CodeThemePair,
): boolean {
  return left.dark === right.dark && left.light === right.light;
}

/**
 * File / FileDiff ignore `options.theme` while a worker pool is active and
 * highlight with the pool's render options instead. Register shipped JSON and
 * push the resolved pair into that pool when it differs from the pair the
 * pool was constructed with (or last received). Keep this module off the app
 * boot path — it pulls `@pierre/diffs`.
 *
 * `constructedTheme` is the pair the caller passed as `highlighterOptions`
 * when it mounted the provider; a pool that already existed keeps whatever
 * pair the sync last applied to it.
 */
export function useSyncPierreWorkerPoolTheme(
  pool: WorkerPoolManager | undefined,
  constructedTheme: CodeThemePair,
): void {
  const resolved = useResolvedCodeTheme();
  registerResolvedCodeThemeFiles();
  const theme = useResolvedCodeThemePair();
  useEffect(() => {
    registerResolvedCodeThemeFiles();
    if (pool == null) return;
    const applied = appliedThemeByPool.get(pool) ?? constructedTheme;
    if (!appliedThemeByPool.has(pool)) {
      appliedThemeByPool.set(pool, constructedTheme);
    }
    if (areCodeThemePairsEqual(applied, theme)) return;
    appliedThemeByPool.set(pool, theme);
    void pool.setRenderOptions({ theme }).catch((error: unknown) => {
      console.error(
        "Failed to apply the code theme to the Pierre worker pool",
        error,
      );
    });
  }, [constructedTheme, pool, resolved, theme]);
}
