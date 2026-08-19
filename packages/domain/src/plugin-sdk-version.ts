/**
 * Version of the BB plugin SDK surface (`@get-bb/plugin-sdk`). Single source of
 * truth shared by the CLI and the server: `bb plugin build` stamps it into a
 * plugin's `dist/app.meta.json` sidecar, and the host compares majors before
 * loading a bundle (design §7 — a stale bundle is skipped legibly, never a
 * TypeError).
 */
// The major is the plugin API compatibility number: a breaking change to the
// plugin API bumps it, and nothing else does. Pre-1.0, both the minor and the
// patch are compatible releases, so a plugin built against any earlier 0.x
// keeps loading — see isPluginSdkRangeSatisfied, which reads each plugin's
// engines.bbPluginSdk range as a floor within the major rather than as a
// ceiling. Do not bump the minor to mark a release; that unloads every
// installed plugin whose manifest carries a caret range.
//
// PLUGIN_SDK_MAJOR is 0, so the major-only artifact gate cannot distinguish
// 0.x releases and is intentionally vacuous for them until a future 1.0.
// Rebuildable artifacts still rebuild on the exact sdkVersion-differs trigger.
export const PLUGIN_SDK_VERSION = "0.4.9";

/** Major of {@link PLUGIN_SDK_VERSION} — the plugin API compatibility number. */
export const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);
