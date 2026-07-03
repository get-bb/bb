// Bundled type declarations for `@bb/plugin-sdk`, shipped into scaffolded
// plugins so they typecheck without the @bb/* workspace on disk.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/ymichael/bb

import { ComponentType } from 'react';

/**
 * The `@bb/plugin-sdk/app` contract (plugin design §5.2) — pure types plus
 * the runtime export-name list, with no side effects. This module is what the
 * BB app imports to keep its real implementation in sync (`satisfies
 * PluginSdkApp`) and what `bb plugin build` imports to generate the shim's
 * named-export list. Plugin authors import the same shapes through
 * `@bb/plugin-sdk/app`.
 *
 * Per-slot props are versioned contracts: additive-only within an SDK major.
 */
/** Props passed to a `homepageSection` component. */
interface PluginHomepageSectionProps {
    /** Project in view on the compose surface; null when none is selected. */
    projectId: string | null;
}
/** Props passed to a `navPanel` component (it owns its whole route). */
interface PluginNavPanelProps {
}
/** Props passed to a panel tab opened by a `threadPanelAction`. */
interface PluginThreadPanelProps {
    threadId: string;
    /**
     * The JSON value the action's `openPanel` call passed (round-tripped
     * through persistence, so the tab restores across reloads); null when the
     * action opened the panel without params.
     */
    params: unknown;
}
/** Props passed to a `composerAccessory` component. */
interface PluginComposerAccessoryProps {
    projectId: string | null;
    threadId: string | null;
}
/**
 * Slot/panel ids and nav-panel paths must match this pattern (letters,
 * digits, `-`, `_`): they ride URLs and persisted panel-tab keys.
 */
declare const PLUGIN_SLOT_ID_PATTERN: RegExp;
interface PluginHomepageSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    component: ComponentType<PluginHomepageSectionProps>;
}
interface PluginNavPanelRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon: string;
    /** URL segment under `/plugins/<pluginId>/`; letters, digits, `-`, `_`. */
    path: string;
    component: ComponentType<PluginNavPanelProps>;
    /**
     * Panel chrome (default "page"): "page" renders the host title bar (plugin
     * logo + `title` + your `headerContent`) above a full-width padded body;
     * "none" hands the ENTIRE panel area to `component` — no host padding, no
     * title bar (`headerContent` is ignored) — only the per-plugin error
     * boundary remains.
     */
    chrome?: "page" | "none";
    /**
     * Optional component rendered on the right side of the "page" title bar
     * (e.g. a sync button or a count). Contained separately from the body: a
     * throwing headerContent is hidden without breaking the title bar.
     */
    headerContent?: ComponentType<PluginNavPanelProps>;
}
/** Context handed to a `threadPanelAction`'s `run`. */
interface PluginThreadPanelActionContext {
    /** The thread whose panel launcher invoked the action. */
    threadId: string;
    /**
     * Open a tab in the thread's side panel rendering this action's
     * `component`. `title` labels the tab (default: the action's `title`);
     * `params` must be JSON-serializable — it is persisted with the tab and
     * reaches the component as its `params` prop. Opening with params
     * identical to an already-open tab of this action focuses that tab
     * (updating its title) instead of duplicating it. May be called more than
     * once (different params ⇒ multiple tabs) or not at all.
     */
    openPanel(options?: {
        title?: string;
        params?: unknown;
    }): void;
}
interface PluginThreadPanelActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label of the action row in the panel's new-tab launcher. */
    title: string;
    /**
     * Icon hint (BB icon name) used when the plugin ships no logo; the
     * launcher row and opened tabs prefer the plugin's logo.
     */
    icon?: string;
    /** Rendered inside every panel tab this action opens. */
    component: ComponentType<PluginThreadPanelProps>;
    /**
     * Runs when the user activates the action: call your RPC methods, show a
     * toast, and/or open panel tabs via `context.openPanel`. Omitted =
     * immediately open a panel tab with defaults. Errors (sync or async) are
     * contained and logged; they never break the launcher.
     */
    run?(context: PluginThreadPanelActionContext): void | Promise<void>;
}
interface PluginComposerAccessoryRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    component: ComponentType<PluginComposerAccessoryProps>;
}
interface PluginAppSlots {
    homepageSection(registration: PluginHomepageSectionRegistration): void;
    navPanel(registration: PluginNavPanelRegistration): void;
    threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
    composerAccessory(registration: PluginComposerAccessoryRegistration): void;
}
interface PluginAppBuilder {
    slots: PluginAppSlots;
}
type PluginAppSetup = (app: PluginAppBuilder) => void;
/**
 * The opaque product of `definePluginApp` — a plugin's `app.tsx` default
 * export. The host re-runs `setup` against a fresh collector on every
 * (re)interpretation, replacing that plugin's registrations wholesale.
 */
interface PluginAppDefinition {
    /** Brand the host checks before interpreting a bundle's default export. */
    readonly __bbPluginApp: true;
    readonly setup: PluginAppSetup;
}
interface PluginRpcClient {
    /**
     * Invoke one of the plugin's `bb.rpc` methods (POST
     * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
     * result; rejects with an `Error` carrying the server's message when the
     * handler fails or the plugin is not running.
     */
    call(method: string, input?: unknown): Promise<unknown>;
}
interface PluginSettingsState {
    /**
     * Effective non-secret setting values (secret settings are excluded —
     * read them server-side). Undefined while loading or unavailable.
     */
    values: Record<string, string | boolean> | undefined;
    isLoading: boolean;
}
/** Current app selection, derived from the route. */
interface BbContext {
    projectId: string | null;
    threadId: string | null;
}
interface BbNavigate {
    toThread(threadId: string): void;
    toProject(projectId: string): void;
    /** Navigate to one of this plugin's own nav panels by its `path`. */
    toPluginPanel(path: string): void;
}
/**
 * Everything `@bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
interface PluginSdkApp {
    definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
    useRpc(): PluginRpcClient;
    useRealtime(channel: string, handler: (payload: unknown) => void): void;
    useSettings(): PluginSettingsState;
    useBbContext(): BbContext;
    useBbNavigate(): BbNavigate;
}
/**
 * Named runtime exports of `@bb/plugin-sdk/app`, in sorted order. Single
 * source of truth for the build shim's export list and the app's
 * implementation-key test — adding a surface member without updating this
 * list fails the type assertion below.
 */
declare const PLUGIN_SDK_APP_EXPORT_NAMES: readonly ["definePluginApp", "useBbContext", "useBbNavigate", "useRealtime", "useRpc", "useSettings"];

declare const definePluginApp: (setup: PluginAppSetup) => PluginAppDefinition;
declare const useRpc: () => PluginRpcClient;
declare const useRealtime: (channel: string, handler: (payload: unknown) => void) => void;
declare const useSettings: () => PluginSettingsState;
declare const useBbContext: () => BbContext;
declare const useBbNavigate: () => BbNavigate;

export { PLUGIN_SDK_APP_EXPORT_NAMES, PLUGIN_SLOT_ID_PATTERN, definePluginApp, useBbContext, useBbNavigate, useRealtime, useRpc, useSettings };
export type { BbContext, BbNavigate, PluginAppBuilder, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginComposerAccessoryProps, PluginComposerAccessoryRegistration, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginNavPanelProps, PluginNavPanelRegistration, PluginRpcClient, PluginSdkApp, PluginSettingsState, PluginThreadPanelActionContext, PluginThreadPanelActionRegistration, PluginThreadPanelProps };
