import { useEffect } from "react";
import { registerCustomTheme } from "@pierre/diffs";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { registerResolvedCodeThemeFiles } from "@/lib/code-theme-registration";
import {
  useResolvedCodeTheme,
  useResolvedCodeThemePair,
} from "@/lib/code-theme";

export interface CodeThemePair {
  dark: string;
  light: string;
}

type ThemeablePierreWorkerPool = Pick<WorkerPoolManager, "setRenderOptions">;

const appliedThemeByPool = new WeakMap<
  ThemeablePierreWorkerPool,
  CodeThemePair
>();

function areCodeThemePairsEqual(
  left: CodeThemePair,
  right: CodeThemePair,
): boolean {
  return left.dark === right.dark && left.light === right.light;
}

export function useSyncPierreWorkerPoolTheme(
  pool: WorkerPoolManager | undefined,
  constructedTheme: CodeThemePair,
): void {
  const resolved = useResolvedCodeTheme();
  registerResolvedCodeThemeFiles(registerCustomTheme);
  const theme = useResolvedCodeThemePair();
  useEffect(() => {
    registerResolvedCodeThemeFiles(registerCustomTheme);
    if (pool == null) return;
    syncPierreWorkerPoolTheme(pool, constructedTheme, theme);
  }, [constructedTheme, pool, resolved, theme]);
}

export function syncPierreWorkerPoolTheme(
  pool: ThemeablePierreWorkerPool,
  constructedTheme: CodeThemePair,
  theme: CodeThemePair,
): void {
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
}
