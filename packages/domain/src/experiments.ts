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
  /**
   * Tools Hub: exposes the unified Skills, Plugins, and Automations management
   * UI. This is a presentation gate only; it does not load or unload tools.
   */
  toolsHub: z.boolean(),
  /**
   * Side chat plugin: replaces the native side-chat implementation with the
   * builtin `side-chat` plugin. ON hides the native "Reply in side chat"
   * entry points and loads the plugin; OFF suppresses the plugin and keeps
   * the legacy path fully functional. Only surfaced in Settings while the
   * `plugins` experiment is on.
   */
  sideChatPlugin: z.boolean(),
});
export type Experiments = z.infer<typeof experimentsSchema>;

export const defaultExperiments: Experiments = {
  claudeCodeMockCliTraffic: false,
  plugins: false,
  toolsHub: false,
  sideChatPlugin: false,
};
