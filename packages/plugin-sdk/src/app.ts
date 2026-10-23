export { experimental_PluginRpcCallError } from "./rpc-contract.js";
import type { PluginSdkApp } from "./app-contract.js";

export type * from "./app-contract.js";
export type * from "./json-value.js";
export type {
  ExperimentalRpcKeyedMethod,
  ExperimentalRpcKeyedValue,
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
  const member = installedApp()?.[name] as PluginSdkApp[Name] | undefined;
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
export const experimental_VoiceInputTextarea = runtimeComponent(
  "experimental_VoiceInputTextarea",
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
// The thread Info tab's building blocks (experimental — see
// docs/api_to_audit.md).
export const experimental_InfoSection = runtimeComponent(
  "experimental_InfoSection",
);
export const experimental_DetailRow = runtimeComponent(
  "experimental_DetailRow",
);
export const experimental_InfoList = runtimeComponent("experimental_InfoList");
export const experimental_InfoListRow = runtimeComponent(
  "experimental_InfoListRow",
);
export const experimental_useRpcQuery = runtimeFunction(
  "experimental_useRpcQuery",
);
export const experimental_useRpcKeyedQuery = runtimeFunction(
  "experimental_useRpcKeyedQuery",
);
export const experimental_useRpcMutation = runtimeFunction(
  "experimental_useRpcMutation",
);
export const experimental_useRpcRefresh = runtimeFunction(
  "experimental_useRpcRefresh",
);

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
export const useComposers = runtimeFunction("useComposers");
export const experimental_useComposerRenderer = runtimeFunction(
  "experimental_useComposerRenderer",
);
export const experimental_useThreadTitleDisplayText = runtimeFunction(
  "experimental_useThreadTitleDisplayText",
);
export const experimental_useComposerContributions = runtimeFunction(
  "experimental_useComposerContributions",
);
export const experimental_useComposerMentionSearch = runtimeFunction(
  "experimental_useComposerMentionSearch",
);
export const experimental_useComposerCommandSearch = runtimeFunction(
  "experimental_useComposerCommandSearch",
);
export const experimental_ComposerRoot = runtimeComponent(
  "experimental_ComposerRoot",
);
export const experimental_VoiceInputButton = runtimeComponent(
  "experimental_VoiceInputButton",
);
export const experimental_VoiceRecordingBar = runtimeComponent(
  "experimental_VoiceRecordingBar",
);
export const experimental_FailedVoiceRecordings = runtimeComponent(
  "experimental_FailedVoiceRecordings",
);
export const experimental_ShortcutHint = runtimeComponent(
  "experimental_ShortcutHint",
);
export const experimental_ImageLightbox = runtimeComponent(
  "experimental_ImageLightbox",
);
export const experimental_PromptMentionIcon = runtimeComponent(
  "experimental_PromptMentionIcon",
);
export const experimental_describePromptMention = runtimeFunction(
  "experimental_describePromptMention",
);
export const experimental_promptMentionClipboardAttributes = runtimeFunction(
  "experimental_promptMentionClipboardAttributes",
);
export const experimental_readPromptMentionClipboard = runtimeFunction(
  "experimental_readPromptMentionClipboard",
);
export const experimental_PluginIcon = runtimeComponent(
  "experimental_PluginIcon",
);
export const experimental_ThreadTitleText = runtimeComponent(
  "experimental_ThreadTitleText",
);
/** @internal Superseded by `useComposer()`; kept for plugins built against older SDKs. */
export const useComposerView = runtimeFunction("useComposerView");
// Sidebar surfaces for plugins that replace the thread list (experimental —
// see docs/api_to_audit.md).
export const experimental_useSidebarThreads = runtimeFunction(
  "experimental_useSidebarThreads",
);
/** @internal Superseded by the thread action registry, `useSdk().threads`, and `useBbNavigate()`; kept for plugins built against older SDKs. */
export const experimental_useSidebarThreadActions = runtimeFunction(
  "experimental_useSidebarThreadActions",
);
export const experimental_useThreadActions = runtimeFunction(
  "experimental_useThreadActions",
);
export const experimental_useArchiveEnvironmentThreads = runtimeFunction(
  "experimental_useArchiveEnvironmentThreads",
);
export const experimental_useThreadActionRegistrations = runtimeFunction(
  "experimental_useThreadActionRegistrations",
);
export const experimental_ThreadActionsMenu = runtimeComponent(
  "experimental_ThreadActionsMenu",
);
export const experimental_ThreadActionsContextMenu = runtimeComponent(
  "experimental_ThreadActionsContextMenu",
);
export { experimental_THREAD_ACTION_GROUPS } from "./thread-action-groups.js";
export {
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS,
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
} from "./thread-info-groups.js";
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
export const experimental_ThreadStatusGlyph = runtimeComponent(
  "experimental_ThreadStatusGlyph",
);
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
// bb's clipboard writer, the one bb's own copy actions use (experimental —
// see docs/api_to_audit.md).
export const experimental_copyToClipboard = runtimeFunction(
  "experimental_copyToClipboard",
);
export const experimental_saveFile = runtimeFunction("experimental_saveFile");
