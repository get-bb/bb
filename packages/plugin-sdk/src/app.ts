import type { PluginSdkApp } from "./app-contract.js";

export type * from "./app-contract.js";
export type * from "./json-value.js";
export type {
  PluginRpcCallArgs,
  PluginRpcContract,
  PluginRpcError,
  PluginRpcErrorCode,
  PluginRpcHandlers,
  PluginRpcIssuePathSegment,
  PluginRpcMethodContract,
  PluginRpcResult,
  PluginRpcValidationIssue,
  StandardSchemaV1,
  StandardSchemaV1InferInput,
  StandardSchemaV1InferOutput,
  StandardSchemaV1Issue,
  StandardSchemaV1Result,
} from "./rpc-contract.js";

/**
 * `@get-bb/plugin-sdk/app` — typed facade over the BB app's plugin runtime.
 *
 * This module's runtime is never bundled into plugins: `bb plugin build`
 * swaps the specifier for a shim reading
 * `globalThis.__bbPluginRuntime.pluginSdkApp` (which the BB app fills with
 * its real implementation before importing any plugin bundle). Code importing
 * this package directly (plugin unit tests, tooling) gets stable forwarders
 * instead: each export looks the runtime up when it is called or rendered,
 * not when this module loads, so it does not matter whether a test imports
 * its components before or after installing a runtime. Calling a hook or
 * rendering a component with no runtime installed throws.
 *
 * Shared hooks and host components, including experimental_Icon. The generic
 * host-provided UI kit was removed 2026-07-03,
 * plugin design §5.5: other components are vendored shadcn-style source from the
 * BB registry (`npx shadcn add @bb/<name>`); `toast` comes from
 * `import { toast } from "sonner"` (runtime-shimmed to the host toaster).
 */

interface PluginRuntimeReact {
  createElement(type: unknown, props: unknown): unknown;
}

interface PluginRuntimeHost {
  __bbPluginRuntime?: { pluginSdkApp?: unknown; react?: PluginRuntimeReact };
}

type RuntimeFunctionName = {
  [Name in keyof PluginSdkApp]: PluginSdkApp[Name] extends (
    ...args: never[]
  ) => unknown
    ? Name
    : never;
}[keyof PluginSdkApp];

function runtimeHost(): PluginRuntimeHost["__bbPluginRuntime"] {
  return (globalThis as PluginRuntimeHost).__bbPluginRuntime;
}

// The global is the genuinely unknowable boundary here: the host app
// guarantees the shape via its own `satisfies PluginSdkApp` check.
function installedApp(): Partial<PluginSdkApp> | undefined {
  return runtimeHost()?.pluginSdkApp as Partial<PluginSdkApp> | undefined;
}

function runtimeMember<Name extends keyof PluginSdkApp>(
  name: Name,
): PluginSdkApp[Name] {
  const member = installedApp()?.[name];
  if (member === undefined) {
    throw new Error(
      `@get-bb/plugin-sdk/app: ${name} needs the bb app's plugin runtime. In tests, call installTestPluginRuntime() from @get-bb/plugin-sdk/testing/app first.`,
    );
  }
  return member;
}

function runtimeFunction<Name extends RuntimeFunctionName>(
  name: Name,
): PluginSdkApp[Name] {
  const forward = (...args: unknown[]) =>
    (runtimeMember(name) as (...args: unknown[]) => unknown)(...args);
  return forward as PluginSdkApp[Name];
}

function runtimeComponent<Name extends keyof PluginSdkApp>(
  name: Name,
): PluginSdkApp[Name] {
  function RuntimeComponent(props: object): unknown {
    const react = runtimeHost()?.react;
    if (react === undefined) {
      throw new Error(
        `@get-bb/plugin-sdk/app: ${name} needs React on the bb plugin runtime. In tests, call installTestPluginRuntime() from @get-bb/plugin-sdk/testing/app first.`,
      );
    }
    return react.createElement(runtimeMember(name), props);
  }
  RuntimeComponent.displayName = name;
  return RuntimeComponent as unknown as PluginSdkApp[Name];
}

export const experimental_Icon = runtimeComponent("experimental_Icon");
export const experimental_ProviderIcon = runtimeComponent(
  "experimental_ProviderIcon",
);
// A definition is a frozen, branded object; building one needs no runtime,
// so a plugin's app.tsx can load before a test installs one.
export const definePluginApp: PluginSdkApp["definePluginApp"] = (setup) => {
  const app = installedApp();
  if (app?.definePluginApp !== undefined) return app.definePluginApp(setup);
  if (typeof setup !== "function") {
    throw new Error("definePluginApp expects a setup function");
  }
  return Object.freeze({ __bbPluginApp: true as const, setup });
};
export const ThreadChat = runtimeComponent("ThreadChat");
export const Markdown = runtimeComponent("Markdown");
export const experimental_FileLink = runtimeComponent("experimental_FileLink");
export const UrlLink = runtimeComponent("UrlLink");
export const experimental_NewThreadComposer = runtimeComponent(
  "experimental_NewThreadComposer",
);
export const experimental_ProviderModelPicker = runtimeComponent(
  "experimental_ProviderModelPicker",
);
export const experimental_PermissionModePicker = runtimeComponent(
  "experimental_PermissionModePicker",
);
export const experimental_BranchPicker = runtimeComponent(
  "experimental_BranchPicker",
);
export const experimental_useBranches = runtimeFunction(
  "experimental_useBranches",
);
export const experimental_useCheckoutState = runtimeFunction(
  "experimental_useCheckoutState",
);
// Host-owned code rendering (experimental — see docs/api_to_audit.md).
export const experimental_SourceCode = runtimeComponent(
  "experimental_SourceCode",
);
export const experimental_Diff = runtimeComponent("experimental_Diff");
export const useRpc = runtimeFunction("useRpc");
export const useRealtime = runtimeFunction("useRealtime");
export const useRealtimeConnectionState = runtimeFunction(
  "useRealtimeConnectionState",
);
export const useSettings = runtimeFunction("useSettings");
export const useBbContext = runtimeFunction("useBbContext");
export const experimental_usePluginId = runtimeFunction(
  "experimental_usePluginId",
);
export const experimental_useQuestionFormHost = runtimeFunction(
  "experimental_useQuestionFormHost",
);
export const useBbNavigate = runtimeFunction("useBbNavigate");
export const experimental_useAppPanel = runtimeFunction(
  "experimental_useAppPanel",
);
export const experimental_useFixedTabTarget = runtimeFunction(
  "experimental_useFixedTabTarget",
);
export const useComposer = runtimeFunction("useComposer");
export const useComposerView = runtimeFunction("useComposerView");
// Sidebar surfaces for plugins that replace the thread list (experimental —
// see docs/api_to_audit.md).
export const experimental_useSidebarThreads = runtimeFunction(
  "experimental_useSidebarThreads",
);
export const experimental_useSidebarThreadActions = runtimeFunction(
  "experimental_useSidebarThreadActions",
);
export const experimental_useSidebarThreadPullRequest = runtimeFunction(
  "experimental_useSidebarThreadPullRequest",
);
export const experimental_useSidebarThreadSplit = runtimeFunction(
  "experimental_useSidebarThreadSplit",
);
export const experimental_useSidebarNavigation = runtimeFunction(
  "experimental_useSidebarNavigation",
);
export const experimental_useSidebarNavigationSplit = runtimeFunction(
  "experimental_useSidebarNavigationSplit",
);
export const experimental_SidebarNavigationIcon = runtimeComponent(
  "experimental_SidebarNavigationIcon",
);
export const useSidebarThreadDraft = runtimeFunction("useSidebarThreadDraft");
export const useSidebarThreadDraftIds = runtimeFunction(
  "useSidebarThreadDraftIds",
);
export const useSidebarThreadRowStatus = runtimeFunction(
  "useSidebarThreadRowStatus",
);
export const useSidebarThreadRowStatuses = runtimeFunction(
  "useSidebarThreadRowStatuses",
);
export const useSidebarSplitLayout = runtimeFunction("useSidebarSplitLayout");
export const useSidebarThreadShortcut = runtimeFunction(
  "useSidebarThreadShortcut",
);
export const ThreadTitle = runtimeComponent("ThreadTitle");
export const useEnvironmentProviders = runtimeFunction(
  "useEnvironmentProviders",
);
// bb's public API client bound to the calling plugin.
export const useSdk = runtimeFunction("useSdk");
// The provider directory (experimental — see docs/api_to_audit.md).
export const experimental_useProviders = runtimeFunction(
  "experimental_useProviders",
);
// The live code theme, for plugins that render code with their own engine
// (experimental — see docs/api_to_audit.md).
export const experimental_useCodeTheme = runtimeFunction(
  "experimental_useCodeTheme",
);
