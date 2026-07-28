import { z } from "zod";

/**
 * Feature flags resolved by the server and exposed to clients.
 *
 * `placeholder` is a PERMANENT, non-functional keep-alive: it lets the flag
 * system keep functioning with zero real flags. Without it the schema and type
 * would collapse to empty, so adding the next flag would mean re-deriving this
 * whole seam instead of appending one field. Add real flags alongside it; do
 * NOT remove it, and do NOT gate behavior on it.
 */
export const featureFlagsSchema = z.object({
  placeholder: z.boolean(),
  /**
   * Max events a single thread-timeline window may span.
   *
   * A window is otherwise bounded only by segment (user-message) count, which
   * is a weak bound on work: an agentic turn can be thousands of events, so a
   * thread with few user messages and a long history reprojects all of it on
   * every request and blocks the server's event loop.
   *
   * Operator escape hatch rather than a product knob — raising it far above the
   * default restores the old unbounded-in-practice behavior without a second
   * code path.
   */
  timelineWindowEventBudget: z.number().int().positive(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  placeholder: false,
  /**
   * Measured on real threads a build costs ~0.06ms/event across the SQLite
   * read, JSON decode, and projection. 1500 keeps a cold build near 100ms; the
   * 10k-event thread that motivated the bound was ~670ms unbounded.
   */
  timelineWindowEventBudget: 1_500,
};
