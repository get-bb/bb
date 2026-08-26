import { useEffect, useState } from "react";
import type {
  PluginCodeThemeData,
  PluginCodeThemeState,
} from "@get-bb/plugin-sdk";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useResolvedCodeTheme } from "@/lib/code-theme";
import { registerResolvedCodeThemeFiles } from "@/lib/code-theme-registration";

/**
 * Theme documents already resolved in this window, keyed by the versioned
 * name the app publishes. A palette the user toggles back and forth costs one
 * resolve, not one per switch.
 */
const cache = new Map<string, PluginCodeThemeData>();

/**
 * Resolve a registered theme name to the VS Code document behind it.
 *
 * `@pierre/diffs` is imported dynamically: this hook can mount on any plugin
 * surface, including ones the highlighter never reaches, and the module is
 * megabytes of Shiki.
 */
async function loadCodeThemeData(name: string): Promise<PluginCodeThemeData> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const { registerCustomTheme, resolveTheme } = await import("@pierre/diffs");
  // Custom palettes and BB's first-party light remaps only exist as JSON the
  // server sends; Pierre cannot resolve their names until they are registered.
  registerResolvedCodeThemeFiles(registerCustomTheme);
  const resolved = await resolveTheme(name);
  const data: PluginCodeThemeData = {
    name,
    type: resolved.type,
    fg: resolved.fg,
    bg: resolved.bg,
    colors: resolved.colors ?? {},
    // Shiki normalizes `tokenColors` into `settings` when it resolves a theme;
    // a hand-registered file that skipped that step still carries the former.
    tokenColors: resolved.settings ?? resolved.tokenColors ?? [],
  };
  cache.set(name, data);
  return data;
}

/**
 * The code theme BB currently renders with, as the VS Code document it was
 * authored as. Exposed to plugins as `experimental_useCodeTheme()` so a plugin
 * embedding its own editor (Monaco, CodeMirror) can translate BB's palette
 * into that editor's theme format instead of approximating it.
 *
 * The previously resolved document is kept while a switch is in flight, so a
 * consumer that repaints on every change never has an unthemed frame.
 */
export function useCodeTheme(): PluginCodeThemeState {
  const mode = usePreferredTheme();
  const resolved = useResolvedCodeTheme();
  const name = mode === "dark" ? resolved.dark : resolved.light;
  const [theme, setTheme] = useState<PluginCodeThemeData | null>(
    () => cache.get(name) ?? null,
  );

  useEffect(() => {
    const cached = cache.get(name);
    if (cached !== undefined) {
      setTheme(cached);
      return;
    }
    let cancelled = false;
    void loadCodeThemeData(name)
      .then((data) => {
        if (!cancelled) setTheme(data);
      })
      .catch((error: unknown) => {
        // Keep the last good document rather than dropping consumers back to
        // an unthemed editor over one bad palette.
        console.error(`Failed to resolve the code theme "${name}"`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return { mode, name, theme };
}
