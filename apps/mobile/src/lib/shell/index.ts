// The WebView shell: URL work, screen-state rules, deep links, and the local
// preference. Pure modules only; the RN glue lives in src/screens/webview.
export {
  buildShellUrl,
  isExternallyOpenable,
  isShellNavigation,
  parseServerUrl,
  shellPathFromUrl,
  type ServerOrigin,
} from "./shell-url";
export {
  resolveShellScreenState,
  shouldReloadForSession,
  type ShellLoadPhase,
  type ShellScreenState,
} from "./shell-state";
export {
  createShellPreferenceStore,
  isRememberablePath,
  lastShellPathStorageKey,
  type ShellPreferenceStorage,
  type ShellPreferenceStore,
} from "./shell-preferences";
export {
  buildBridgeSharePayload,
  type NativeSharePayload,
} from "./shell-share";
export {
  isNativeOnlyShellPath,
  resolveShellIncomingLink,
  shellHref,
  SHELL_ROUTE_PATH,
  type ResolveShellLinkContext,
  type ShellHrefParams,
} from "./shell-links";
export {
  sendShellCommand,
  subscribeToShellCommands,
  type ShellCommand,
} from "./shell-commands";
export { getShellPreferenceStore } from "./shell-preference-store";
