/**
 * Color helpers for the showcase heroes' mini-window scenes.
 *
 * Every value derives from a theme token, never an `oklch(L 0 0)` literal, so
 * a custom palette (Nord, Dracula) that re-anchors --canvas/--ink retints the
 * whole hero instead of stranding it in neutral gray.
 *
 * Which interpolation space depends on the poles, matching the rule in
 * `plugin-ui.tsx`: chromatic tokens (--file-accent, --success, …) mix `in
 * oklab` so a low-percentage tint keeps its hue instead of being dragged
 * through the achromatic anchor's 0°; neutral --ink/--canvas steps mix `in
 * oklch`, where both poles are achromatic and there is no hue to lose.
 */

/** An opaque tint of a chromatic accent token against the canvas. */
export function accentTint(token: string, percent: number): string {
  return `color-mix(in oklab, var(${token}) ${percent}%, var(--canvas))`;
}

/** Accent text/fill that stays legible by pulling toward --ink. */
export function accentInk(token: string, percent: number): string {
  return `color-mix(in oklab, var(${token}) ${percent}%, var(--ink))`;
}

/** A neutral step between the canvas and ink anchors. */
export function neutral(percent: number): string {
  return `color-mix(in oklch, var(--ink) ${percent}%, var(--canvas))`;
}
