/**
 * Version of the BB plugin SDK surface (`@bb/plugin-sdk`). Single source of
 * truth shared by the CLI and the server: `bb plugin build` stamps it into a
 * plugin's `dist/app.meta.json` sidecar, and the host compares majors before
 * loading a bundle (design §7 — a stale bundle is skipped legibly, never a
 * TypeError). Bump the major for breaking changes to any stable SDK surface.
 */
// Pre-release: the surface (navPanel chrome/headerContent, PageBody, logos,
// @scope'd CSS) grows additively under 0.1.0 — nothing has shipped, so there
// are no installs to force-migrate with a version bump. Post-release, bump
// this when existing path/git installs must rebuild at load (the server
// rebuilds when the recorded sdkVersion differs) and bump the major for
// breaking changes.
export const PLUGIN_SDK_VERSION = "0.1.0";

/** Major of {@link PLUGIN_SDK_VERSION} — the plugin API compatibility number. */
export const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);
