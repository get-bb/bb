/**
 * The plugin bundle build engine — frontend (design §5.1) and prebuilt
 * backend (design §6) bundles. One implementation
 * shared by its two real callers: `bb plugin build` in the CLI, and the
 * server's install-time / boot-time (SDK skew) rebuilds of path:/git:
 * plugins. The heavy toolchain (esbuild, Tailwind's native oxide scanner) is
 * dynamically imported inside {@link buildPluginApp}, so merely importing
 * this package never loads native addons — a server that rebuilds nothing
 * pays nothing.
 *
 * Neither shipped caller depends on that toolchain: they resolve it with
 * {@link resolvePluginBuildToolchain}, which installs a pinned set into the
 * data dir the first time something is actually built. Only the monorepo's
 * own build scripts use the bare-specifier default, where the packages are
 * devDependencies.
 */
export {
  buildPluginApp,
  RUNTIME_SLOT_BY_SPECIFIER,
  type PluginAppBuildOptions,
  type PluginAppBuildResult,
} from "./build-plugin-app.js";
export {
  buildPluginServer,
  PLUGIN_SERVER_EXTERNALS,
  type PluginServerBuildResult,
} from "./build-plugin-server.js";
export {
  buildPluginHost,
  HOST_ARTIFACT_RUNTIME_STUBS,
  type PluginHostBuildResult,
} from "./build-plugin-host.js";
export * from "./plugin-dev-loop.js";
export {
  PLUGIN_TOOLCHAIN_PINS,
  resolvePluginBuildToolchain,
  toolchainCacheDir,
  type PluginBuildToolchain,
} from "./toolchain.js";
export { assertValidPluginCompactIconSvg } from "./svg-asset.js";
