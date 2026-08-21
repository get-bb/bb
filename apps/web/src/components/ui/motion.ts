/**
 * Shared hover-motion heuristic for primitives, so the whole UI speaks one
 * timing language instead of ad-hoc per-component transitions:
 *
 * - CONTROL_HOVER_TRANSITION — interactive controls (buttons, icon buttons):
 *   the hover/active fill snaps IN instantly (0ms) and eases OUT lazily (150ms).
 *   Immediate feedback on the way in, never twitchy on the way out. The trick:
 *   CSS applies the *end state's* transition-duration for each direction, so a
 *   base `duration-150` governs hover-out while `hover:duration-0` makes
 *   hover-in instant.
 *
 * Reach for one of these rather than a bare `transition-colors` on anything with
 * a hover/active state.
 */
export const CONTROL_HOVER_TRANSITION =
  "transition-colors duration-150 hover:duration-0";
