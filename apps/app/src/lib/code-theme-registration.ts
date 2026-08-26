import type { registerCustomTheme } from "@pierre/diffs";
import { stampRegisteredThemeName } from "@bb/domain";
import { getResolvedCodeTheme } from "@/lib/code-theme";

/**
 * Theme files this window has already handed to Pierre. Shared by every caller
 * because `registerCustomTheme` treats a second registration of the same name
 * as an error it only logs — the set is what keeps that off the console when
 * both the worker-pool sync and a plugin resolve the same custom palette.
 */
const registeredFileNames = new Set<string>();

/**
 * Register every JSON theme file the active palette ships (custom palettes and
 * BB's first-party light remaps) under its versioned wire name.
 *
 * The registrar is passed in rather than imported so a caller that reaches
 * `@pierre/diffs` through a dynamic import does not pull it statically here.
 */
export function registerResolvedCodeThemeFiles(
  register: typeof registerCustomTheme,
): void {
  const resolved = getResolvedCodeTheme();
  for (const [name, theme] of Object.entries(resolved.files)) {
    if (registeredFileNames.has(name)) continue;
    registeredFileNames.add(name);
    const stamped = stampRegisteredThemeName(name, theme);
    register(name, () => Promise.resolve(stamped));
  }
}
