import { z } from "zod";

/**
 * User-opt-in experiments (the Settings → Experiments toggles). Distinct from
 * `FeatureFlags`: flags are operator-set via env at server start, experiments
 * are user-toggled at runtime and persisted server-side so server-owned
 * policy (e.g. skill injection) can honor them.
 *
 * Every experiment defaults to off — opting in is the point.
 */
export const experimentsSchema = z.object({
  /**
   * Claude Code mock CLI traffic: routes Claude Code API requests through the
   * local proxy so forwarded requests use CLI-shaped traffic.
   */
  claudeCodeMockCliTraffic: z.boolean(),
  /**
   * Plugins: enables the plugin system (loader, `bb plugin` commands, plugin
   * API routes). Off by default — when off no plugin code is loaded and the
   * plugin endpoints return a structured "disabled" error.
   */
  plugins: z.boolean(),
});
export type Experiments = z.infer<typeof experimentsSchema>;

export const defaultExperiments: Experiments = {
  claudeCodeMockCliTraffic: false,
  plugins: false,
};
