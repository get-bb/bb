import { APP_RUNTIME_BROWSER_BUNDLE } from "./app-runtime-browser-bundle.generated.js";

export type {
  AppRuntimeBootstrap,
  CreateInjectedBbSdkArgs,
} from "./app-runtime-core.js";
export type { InjectedAppWindowBb } from "./app-window.js";
export {
  createInjectedBbSdk,
  createInjectedCurrentAppDataArea,
} from "./app-runtime-core.js";

export interface CreateAppRuntimeScriptArgs {
  bootstrapJson: string;
}

export function createAppRuntimeScript(
  args: CreateAppRuntimeScriptArgs,
): string {
  return [
    "(function () {",
    `window.__BB_APP_RUNTIME_BOOTSTRAP__ = ${args.bootstrapJson};`,
    APP_RUNTIME_BROWSER_BUNDLE,
    "})();",
  ].join("\n");
}
