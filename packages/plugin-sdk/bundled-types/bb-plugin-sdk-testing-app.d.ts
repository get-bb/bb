// Portable type declarations for `@bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/ymichael/bb

import { ReactNode, ComponentType } from 'react';
import { RenderResult } from '@testing-library/react';
import { PluginHomepageSectionRegistration, PluginSettingsSectionRegistration, PluginNavPanelRegistration, PluginThreadPanelActionRegistration, ComposerCustomization, PluginPendingInteractionRegistration, PluginSidebarFooterActionRegistration, PluginFileOpenerRegistration, PluginMessageDirectiveRegistration, PluginMessageActionRegistration, PluginComposerScope, PluginComposerTextEffect, PluginComposerThreadRowStatus, PluginComposerMention, PluginAppDefinition, PluginRpcContract, StandardSchemaV1InferInput, PluginRpcResult, PluginRealtimeConnectionState } from '@bb/plugin-sdk';

/**
 * `@bb/plugin-sdk/testing/app` — the frontend plugin test harness. Tests a
 * plugin's `app.tsx` source directly under vitest + jsdom, without the bb
 * host or the esbuild bundle:
 *
 * - {@link installTestPluginRuntime} fills `globalThis.__bbPluginRuntime.
 *   pluginSdkApp` with a test implementation of the `@bb/plugin-sdk/app`
 *   surface (the same seam `bb plugin build` shims to the real app). It must
 *   run BEFORE the plugin's `app.tsx` module evaluates, because that module
 *   binds the runtime at import time — so import `app.tsx` through
 *   {@link loadPluginApp}'s thunk form, or call the installer from a vitest
 *   setup file when you prefer static imports.
 * - {@link loadPluginApp} runs the definition's setup against a validating
 *   collector (ported from the BB app's interpreter, same error messages)
 *   and returns the typed slot registrations.
 * - {@link renderSlot} mounts one registration's component with mock hook
 *   backends: rpc as a method→handler map with a call log, realtime as a
 *   channel you can push events into, settings/context as plain values, and
 *   navigate/composer as recorders. Its `behavior`, `inspection`, and
 *   `lifecycle` views separate host inputs, assertions, and mount controls;
 *   the existing direct members remain aliases.
 *
 * Add `// @vitest-environment jsdom` to test files using renderSlot.
 */
interface RpcCall {
    method: string;
    input: unknown;
}
type NavigateCall = {
    method: "toThread";
    threadId: string;
} | {
    method: "toProject";
    projectId: string;
} | {
    method: "toPluginPanel";
    path: string;
    options?: {
        subPath?: string;
        replace?: boolean;
    };
} | {
    method: "toCompose";
    options?: {
        initialPrompt?: string;
        focusPrompt?: boolean;
    };
};
interface ComposerLog {
    /** Latest plain text in this isolated composer scope. */
    readonly text: string;
    /** Latest host-provided composer scope. */
    readonly scope: PluginComposerScope;
    /** Latest host-provided attachment count exposed through `useComposerView()`. */
    readonly attachmentCount: number;
    /** Latest host-rendered text effect requested by the plugin. */
    textEffect: PluginComposerTextEffect | null;
    textEffectCalls: Array<PluginComposerTextEffect | null>;
    /** Whether this plugin currently holds the composer input lock. */
    inputLocked: boolean;
    inputLockCalls: boolean[];
    /** Latest host-rendered thread-row status requested by the plugin. */
    threadRowStatus: PluginComposerThreadRowStatus | null;
    threadRowStatusCalls: Array<PluginComposerThreadRowStatus | null>;
    quotes: string[];
    mentions: PluginComposerMention[];
    focusCount: number;
}
/**
 * Install the test runtime at `globalThis.__bbPluginRuntime.pluginSdkApp`.
 * Idempotent per module instance; must run before the plugin's `app.tsx`
 * (and therefore `@bb/plugin-sdk/app`) is imported.
 */
declare function installTestPluginRuntime(): void;
interface CapturedPluginApp {
    homepageSections: PluginHomepageSectionRegistration[];
    settingsSections: PluginSettingsSectionRegistration[];
    navPanels: PluginNavPanelRegistration[];
    threadPanelActions: PluginThreadPanelActionRegistration[];
    composerCustomizations: ComposerCustomization[];
    pendingInteractions: PluginPendingInteractionRegistration[];
    sidebarFooterActions: PluginSidebarFooterActionRegistration[];
    fileOpeners: PluginFileOpenerRegistration[];
    messageDirectives: PluginMessageDirectiveRegistration[];
    messageActions: PluginMessageActionRegistration[];
}
type PluginAppModule = {
    default: unknown;
};
type PluginAppSource = PluginAppDefinition | PluginAppModule | (() => Promise<PluginAppDefinition | PluginAppModule>);
/**
 * Install the test runtime, resolve the plugin app definition, and capture
 * its slot registrations. Pass a thunk (`() => import("../app.tsx")`) so the
 * plugin module evaluates after the runtime is installed — a static import
 * would bind `definePluginApp` before the installer runs.
 */
declare function loadPluginApp(source: PluginAppSource): Promise<CapturedPluginApp>;
type PluginRpcTestHandlers<Contract extends PluginRpcContract> = {
    [Method in keyof Contract]: (input: StandardSchemaV1InferInput<Contract[Method]["input"]>) => PluginRpcResult<Contract[Method]> | Promise<PluginRpcResult<Contract[Method]>>;
};
interface RenderSlotOptions<Contract extends PluginRpcContract = PluginRpcContract> {
    /**
     * Backing handlers for `useRpc().call`: method name → implementation.
     * Inputs and results are JSON-round-tripped like the wire; a method
     * without a handler rejects, and a throwing handler rejects with its
     * message (what the real rpc client surfaces).
     */
    rpc?: PluginRpcTestHandlers<Contract>;
    /** `useSettings()` values; omitted → `{ values: undefined, isLoading: false }`. */
    settings?: Record<string, string | boolean>;
    /** `useBbContext()` selection; both default to null. */
    context?: {
        projectId?: string | null;
        threadId?: string | null;
    };
    /** Initial `useRealtimeConnectionState()` value; defaults to `connected`. */
    realtimeConnectionState?: PluginRealtimeConnectionState;
    /** Initial state for this render's isolated composer scope and view. */
    composer?: {
        text?: string;
        scope?: PluginComposerScope;
        attachmentCount?: number;
    };
}
/** Host-originated inputs a slot test can drive deterministically. */
interface RenderedSlotBehaviorDrivers {
    /**
     * Push a realtime event to `useRealtime(channel, …)` subscribers, wrapped
     * in act. The payload is JSON-round-tripped like `bb.realtime.publish`.
     */
    emitRealtime(channel: string, payload: unknown): Promise<void>;
    /** Drive the lifecycle of the same connection used by realtime events. */
    setRealtimeConnectionState(state: PluginRealtimeConnectionState): Promise<void>;
    /** Replace composer text as a host-originated edit, wrapped in act. */
    setComposerText(text: string): Promise<void>;
    /** Replace the scope snapshots returned by composer hooks, wrapped in act. */
    setComposerScope(scope: PluginComposerScope): Promise<void>;
}
/** Read-only call/write logs produced while the slot is mounted. */
interface RenderedSlotInspectionState {
    /** Every `useRpc().call`, in order. */
    readonly rpcCalls: RpcCall[];
    /** Every `useBbNavigate()` call, in order. */
    readonly navigateCalls: NavigateCall[];
    /** Everything written through `useComposer()`. */
    readonly composer: ComposerLog;
}
/** Explicit mount controls, separate from behavior inputs and call logs. */
interface RenderedSlotLifecycleControls {
    rerender(ui: ReactNode): void;
    unmount(): void;
}
/**
 * Testing Library result plus BB-specific helpers. Direct members are
 * retained for compatibility; named views make intent explicit in new tests.
 */
interface RenderedSlot extends RenderResult, RenderedSlotBehaviorDrivers, RenderedSlotInspectionState {
    readonly behavior: RenderedSlotBehaviorDrivers;
    readonly inspection: RenderedSlotInspectionState;
    readonly lifecycle: RenderedSlotLifecycleControls;
}
declare function renderSlot<Props extends object, Contract extends PluginRpcContract = PluginRpcContract>(registration: {
    component: ComponentType<Props>;
}, props: Props, options?: RenderSlotOptions<Contract>): RenderedSlot;

export { installTestPluginRuntime, loadPluginApp, renderSlot };
export type { CapturedPluginApp, ComposerLog, NavigateCall, PluginAppSource, PluginRpcTestHandlers, RenderSlotOptions, RenderedSlot, RenderedSlotBehaviorDrivers, RenderedSlotInspectionState, RenderedSlotLifecycleControls, RpcCall };
