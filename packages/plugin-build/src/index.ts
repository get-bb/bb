/**
 * The plugin bundle build engine — frontend (design §5.1) and prebuilt
 * backend (design §6) bundles. One implementation
 * shared by its two real callers: `bb plugin build` in the CLI, and the
 * server's install-time / boot-time (SDK skew) rebuilds of path:/git:
 * plugins. The heavy toolchain (esbuild, Tailwind's native oxide scanner) is
 * dynamically imported inside {@link buildPluginApp}, so merely importing
 * this package never loads native addons — a server that rebuilds nothing
 * pays nothing.
 */
export {
  buildPluginApp,
  type PluginAppBuildResult,
} from "./build-plugin-app.js";
export {
  buildPluginServer,
  type PluginServerBuildResult,
} from "./build-plugin-server.js";
