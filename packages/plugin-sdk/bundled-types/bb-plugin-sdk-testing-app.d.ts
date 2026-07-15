// Portable type declarations for `@bb/plugin-sdk`, with BB workspace
// contracts flattened so external consumers resolve no @bb/* packages.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/ymichael/bb

import { ComponentType, ReactNode } from 'react';
import { RenderResult } from '@testing-library/react';

/**
 * A value that survives a JSON round trip without coercion or data loss.
 *
 * Host boundaries still validate values at runtime because TypeScript cannot
 * exclude non-finite numbers and plugin bundles can bypass static types.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};

/**
 * The validator-neutral subset of Standard Schema v1 used by plugin RPC.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of BB's public protocol.
 */
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
        readonly types?: {
            readonly input: Input;
            readonly output: Output;
        };
    };
}
type StandardSchemaV1Result<Output> = {
    readonly value: Output;
    readonly issues?: undefined;
} | {
    readonly issues: readonly StandardSchemaV1Issue[];
};
interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: PropertyKey | readonly (PropertyKey | {
        readonly key: PropertyKey;
    })[];
}
type StandardSchemaV1InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
interface PluginRpcMethodContract<InputSchema extends StandardSchemaV1 = StandardSchemaV1, OutputSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly input: InputSchema;
    readonly output: OutputSchema;
}
type PluginRpcContract = Readonly<Record<string, PluginRpcMethodContract>>;
type PluginRpcResult<Method extends PluginRpcMethodContract> = StandardSchemaV1InferOutput<Method["output"]>;

/**
 * The `@bb/plugin-sdk/app` contract (plugin design §5.2) — pure types with no
 * side effects. The BB app imports these to keep its real implementation in
 * sync (`satisfies PluginSdkApp`). Plugin authors import the same shapes through
 * `@bb/plugin-sdk/app`.
 *
 * Per-slot props are versioned contracts: additive-only within an SDK major.
 */
/** Props passed to a `homepageSection` component. */
interface PluginHomepageSectionProps {
    /** Project in view on the compose surface; null when none is selected. */
    projectId: string | null;
}
/**
 * Props passed to a `settingsSection` component.
 *
 * Deliberately empty in V1; versioned additive like the other slot props.
 */
interface PluginSettingsSectionProps {
}
/** Props passed to a `navPanel` component (it owns its whole route). */
interface PluginNavPanelProps {
    /**
     * The route remainder after the panel root, "" at the root. The panel's
     * route is `/plugins/<pluginId>/<path>/*`, so a deep link like
     * `/plugins/notes/notes/work/ideas.md` renders the panel with
     * `subPath: "work/ideas.md"`. Navigate within the panel via
     * `useBbNavigate().toPluginPanel(path, { subPath })` — browser
     * back/forward then walks panel-internal history.
     */
    subPath: string;
}
/** Props passed to a panel tab opened by a `threadPanelAction`. */
interface PluginThreadPanelProps {
    threadId: string;
    /**
     * The JSON value the action's `openPanel` call passed (round-tripped
     * through persistence, so the tab restores across reloads); null when the
     * action opened the panel without params.
     */
    params: JsonValue | null;
}
/** Props passed to a `composerAccessory` component. */
interface PluginComposerAccessoryProps {
    projectId: string | null;
    threadId: string | null;
}
interface PluginPendingInteractionView {
    id: string;
    threadId: string;
    title: string;
    payload: JsonValue;
    createdAt: number;
    expiresAt: number | null;
}
interface PluginPendingInteractionProps {
    interaction: PluginPendingInteractionView;
    submit(value: JsonValue): Promise<void>;
    cancel(): Promise<void>;
}
/**
 * Where a file being opened by a `fileOpener` lives. `path` semantics follow
 * the source: workspace paths are relative to the environment's worktree,
 * thread-storage paths are relative to the thread's storage root, host paths
 * are absolute on the thread's host.
 */
interface PluginFileOpenerSource {
    kind: "workspace" | "host" | "thread-storage";
    threadId: string | null;
    environmentId: string | null;
    projectId: string | null;
}
/** Props passed to a `fileOpener` component (rendered as a panel file tab). */
interface PluginFileOpenerProps {
    path: string;
    source: PluginFileOpenerSource;
}
/**
 * Message context passed to a `messageDirective` component — the assistant
 * (or nested agent) message that contained the directive.
 */
interface PluginMessageDirectiveMessage {
    id: string;
    threadId: string;
    turnId: string | null;
    projectId: string | null;
}
/**
 * Open a worktree-relative file in the host's workspace file viewer. Returns
 * true when the host accepted the path; false when the path is invalid or the
 * viewer declined it.
 */
type PluginMessageDirectiveOpenWorkspaceFile = (path: string) => boolean;
interface PluginMessageDirectiveThreadPanelOptions {
    /** A `threadPanelAction` id registered by this same plugin. */
    actionId: string;
    title?: string;
    params?: JsonValue;
}
/** Open this plugin's registered action in the current thread side panel. */
type PluginMessageDirectiveOpenThreadPanel = (options: PluginMessageDirectiveThreadPanelOptions) => boolean;
/**
 * Props passed to a `messageDirective` component. Attributes are untrusted
 * strings parsed from the directive; the plugin validates its own fields.
 */
interface PluginMessageDirectiveProps {
    /** Parsed, untrusted directive attributes (e.g. `{ file: "demo.html" }`). */
    attributes: Readonly<Record<string, string>>;
    /** Original directive source text (useful for diagnostics / crash fallback). */
    source: string;
    message: PluginMessageDirectiveMessage;
    /**
     * Opens a worktree-relative file in the host's workspace file viewer. Null
     * when the message surface has no workspace viewer available.
     */
    openWorkspaceFile: PluginMessageDirectiveOpenWorkspaceFile | null;
    /**
     * Opens one of this plugin's own `threadPanelAction` components in the
     * current thread side panel. Omitted by older hosts; null on message
     * surfaces without a thread panel.
     */
    openThreadPanel?: PluginMessageDirectiveOpenThreadPanel | null;
}
interface PluginHomepageSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    component: ComponentType<PluginHomepageSectionProps>;
}
interface PluginSettingsSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Optional host-rendered section heading. */
    title?: string;
    /**
     * Optional one-line host-rendered subheading under `title`, in the built-in
     * SettingsSection idiom (ignored when `title` is absent).
     */
    description?: string;
    component: ComponentType<PluginSettingsSectionProps>;
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
     * Optional component rendered on the right side of the shared title bar
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
        params?: JsonValue;
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
interface PluginPendingInteractionRegistration {
    /** Matches `rendererId` passed to `bb.ui.requestInput`. */
    id: string;
    component: ComponentType<PluginPendingInteractionProps>;
}
/** Context handed to a `sidebarFooterAction`'s `run`. */
interface PluginSidebarFooterActionContext {
    /**
     * Navigate to this plugin's Settings detail page
     * (`/settings/plugins/<pluginId>`), where declarative settings and
     * `settingsSection` slots render.
     */
    openSettings(): void;
}
/**
 * An icon button in the app sidebar footer (next to Settings / bug report).
 * Host-rendered for consistent chrome — plugins supply icon, label, and
 * `run` behavior only.
 */
interface PluginSidebarFooterActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip and accessible label for the icon button. */
    title: string;
    /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
    icon: string;
    /**
     * Runs when the user activates the action (e.g. call `openSettings()`,
     * open a panel via other surfaces, toast). Errors (sync or async) are
     * contained and logged; they never break the sidebar.
     */
    run(context: PluginSidebarFooterActionContext): void | Promise<void>;
}
/**
 * Register this plugin as a viewer/editor for file extensions. The user
 * picks (and can set as default) an opener per extension via the file tab's
 * "Open with" menu; matching files opened in the panel then render
 * `component` in a plugin tab instead of the built-in preview. Applies to
 * working-tree, host, and thread-storage files — never to git-ref snapshots
 * (diff views always use the built-in preview). The built-in preview stays
 * one menu click away, and a missing/disabled opener falls back to it.
 */
interface PluginFileOpenerRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label in the "Open with" menu (e.g. "Notes editor"). */
    title: string;
    /** Lowercase extensions without the dot (e.g. ["md", "mdx"]). */
    extensions: readonly string[];
    component: ComponentType<PluginFileOpenerProps>;
}
/**
 * Register a leaf message directive rendered inside assistant (and nested
 * agent) message Markdown. `id` is the directive name: `inline-vis` matches
 * `::inline-vis{file="demo.html"}`.
 */
interface PluginMessageDirectiveRegistration {
    /**
     * The directive name. Lowercase kebab-case beginning with a letter.
     */
    id: string;
    component: ComponentType<PluginMessageDirectiveProps>;
}
interface PluginAppSlots {
    homepageSection(registration: PluginHomepageSectionRegistration): void;
    settingsSection(registration: PluginSettingsSectionRegistration): void;
    navPanel(registration: PluginNavPanelRegistration): void;
    threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
    composerAccessory(registration: PluginComposerAccessoryRegistration): void;
    pendingInteraction(registration: PluginPendingInteractionRegistration): void;
    sidebarFooterAction(registration: PluginSidebarFooterActionRegistration): void;
    fileOpener(registration: PluginFileOpenerRegistration): void;
    messageDirective(registration: PluginMessageDirectiveRegistration): void;
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
/** An @-mention pill bound to one of the calling plugin's mention providers. */
interface PluginComposerMention {
    /** Mention provider id registered by THIS plugin via `bb.ui.registerMentionProvider`. */
    provider: string;
    /** Item id your provider's `resolve` will receive at send time. */
    id: string;
    /** Pill text shown in the composer. */
    label: string;
}

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
    composerAccessories: PluginComposerAccessoryRegistration[];
    pendingInteractions: PluginPendingInteractionRegistration[];
    sidebarFooterActions: PluginSidebarFooterActionRegistration[];
    fileOpeners: PluginFileOpenerRegistration[];
    messageDirectives: PluginMessageDirectiveRegistration[];
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
    /** Initial plain text for this render's isolated `useComposer()` scope. */
    composer?: {
        text?: string;
    };
}
/** Host-originated inputs a slot test can drive deterministically. */
interface RenderedSlotBehaviorDrivers {
    /**
     * Push a realtime event to `useRealtime(channel, …)` subscribers, wrapped
     * in act. The payload is JSON-round-tripped like `bb.realtime.publish`.
     */
    emitRealtime(channel: string, payload: unknown): Promise<void>;
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
