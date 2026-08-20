/**
 * Version of the BB plugin SDK surface (`@get-bb/plugin-sdk`). Single source of
 * truth shared by the CLI and the server: `bb plugin build` stamps it into a
 * plugin's `dist/app.meta.json` sidecar, and the host compares majors before
 * loading a bundle (design §7 — a stale bundle is skipped legibly, never a
 * TypeError).
 */
// The major is the plugin API compatibility number: a breaking change to the
// plugin API bumps it, and nothing else does. Within a major, engines.bbPluginSdk
// ranges are treated as a floor (see isPluginSdkRangeSatisfied). Silk-backed
// compact overlays and the removed Vaul runtime slot land as major 1.
export const PLUGIN_SDK_VERSION = "1.0.0";

/** Major of {@link PLUGIN_SDK_VERSION} — the plugin API compatibility number. */
export const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);
