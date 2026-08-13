/**
 * Version of the BB plugin SDK surface (`@bb/plugin-sdk`). Single source of
 * truth shared by the CLI and the server: `bb plugin build` stamps it into a
 * plugin's `dist/app.meta.json` sidecar, and the host compares majors before
 * loading a bundle (design §7 — a stale bundle is skipped legibly, never a
 * TypeError).
 */
// The SDK remains pre-1.0: compatible additions bump the patch, while breaking
// changes bump the 0.x minor. Consequently
// PLUGIN_SDK_MAJOR is 0, so the major-only artifact gate cannot distinguish
// 0.x releases and is intentionally vacuous for them until a future 1.0.
// Pre-1.0 compatibility rides on each plugin's engines.bbPluginSdk range plus
// the exact sdkVersion-differs rebuild trigger for rebuildable artifacts.
export const PLUGIN_SDK_VERSION = "0.4.2";

/** Major of {@link PLUGIN_SDK_VERSION} — the plugin API compatibility number. */
export const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);
