/**
 * Shared collapse/expand easing for the thread-detail panels that animate
 * between sizes (the secondary panel, the terminal panel, and the collapsible
 * conversation/timeline panel). Kept in one place so the duration and easing
 * stay in lockstep across all of them.
 */
export const PANEL_COLLAPSE_TRANSITION_CLASS =
  "duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]";
