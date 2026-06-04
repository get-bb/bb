import {
  APP_RUNTIME_BROWSER_BUNDLE,
  APP_RUNTIME_BROWSER_BUNDLE_SHA256,
} from "./app-runtime-browser-bundle.generated.js";

export type {
  AppRuntimeBootstrap,
  CreateInjectedBbSdkArgs,
  InjectedBbSdk,
} from "./app-runtime-core.js";
export type { InjectedAppWindowBb } from "./app-window.js";
export { createInjectedBbSdk } from "./app-runtime-core.js";

export interface AppRuntimeBrowserBundle {
  /** Exact JavaScript text of the window.bb browser runtime. */
  contents: string;
  /**
   * sha256 hex digest of `contents`. Servers use it as the content hash for
   * immutable caching of the served runtime asset.
   */
  sha256: string;
}

export const appRuntimeBrowserBundle: AppRuntimeBrowserBundle = {
  contents: APP_RUNTIME_BROWSER_BUNDLE,
  sha256: APP_RUNTIME_BROWSER_BUNDLE_SHA256,
};

export interface CreateAppRuntimeBootstrapScriptArgs {
  bootstrapJson: string;
}

/**
 * Builds the inline bootstrap statement that must execute before the runtime
 * bundle script. It stays inline in served HTML because it carries
 * per-response values (the app session token); the runtime bundle itself is
 * served separately as a shared, content-hashed asset.
 */
export function createAppRuntimeBootstrapScript(
  args: CreateAppRuntimeBootstrapScriptArgs,
): string {
  return `window.__BB_APP_RUNTIME_BOOTSTRAP__ = ${args.bootstrapJson};`;
}
