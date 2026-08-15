import { useEffect } from "react";
import { registerCustomTheme } from "@pierre/diffs";
import { useWorkerPool } from "@pierre/diffs/react";
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

/**
 * File / FileDiff ignore `options.theme` while a worker pool is active and
 * highlight with the pool's render options instead. Register shipped JSON and
 * push the resolved pair into that pool. Keep this module off the app boot
 * path — it pulls `@pierre/diffs`.
 */
export function useSyncPierreWorkerPoolTheme(): void {
  const resolved = useResolvedCodeTheme();
  registerResolvedCodeThemeFiles();
  const pool = useWorkerPool();
  const theme = useResolvedCodeThemePair();
  useEffect(() => {
    registerResolvedCodeThemeFiles();
    if (pool == null) return;
    void pool.setRenderOptions({ theme }).catch((error: unknown) => {
      console.error(
        "Failed to apply the code theme to the Pierre worker pool",
        error,
      );
    });
  }, [pool, resolved, theme]);
}
