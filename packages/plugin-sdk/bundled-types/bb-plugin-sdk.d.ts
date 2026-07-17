// Portable type declarations for `@bb/plugin-sdk`. Unpublished BB
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @bb/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/ymichael/bb

import { ComponentType } from 'react';
import Database from 'better-sqlite3';
import { Context } from 'hono';
import * as z from 'zod';
import { z as z$1 } from 'zod';

/**
 * A value that survives a JSON round trip without coercion or data loss.
 *
 * Host boundaries still validate values at runtime because TypeScript cannot
 * exclude non-finite numbers and plugin bundles can bypass static types.
 */
type JsonValue$1 = string | number | boolean | null | JsonValue$1[] | {
    [key: string]: JsonValue$1;
};

/** A JSON-safe path segment reported by a Standard Schema validation issue. */
type PluginRpcIssuePathSegment = string | number;
/** Validator-neutral validation detail carried by an RPC error envelope. */
interface PluginRpcValidationIssue {
    message: string;
    path?: PluginRpcIssuePathSegment[];
}
/** Stable wire error categories for plugin RPC. */
type PluginRpcErrorCode = "invalid_json" | "invalid_input" | "handler_error" | "invalid_output" | "non_json_result" | "unknown_method";
/** Structured RPC failure returned as `{ ok: false, error }`. */
interface PluginRpcError {
    code: PluginRpcErrorCode;
    message: string;
    issues?: PluginRpcValidationIssue[];
}
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
/** Define a shared RPC contract while preserving exact method/schema types. */
declare function defineRpcContract<const Contract extends PluginRpcContract>(contract: Contract): Contract;
type PluginRpcHandlers<Contract extends PluginRpcContract> = {
    [Method in keyof Contract]: (input: StandardSchemaV1InferOutput<Contract[Method]["input"]>) => StandardSchemaV1InferInput<Contract[Method]["output"]> | Promise<StandardSchemaV1InferInput<Contract[Method]["output"]>>;
};
type PluginRpcCallInput<Method extends PluginRpcMethodContract> = StandardSchemaV1InferInput<Method["input"]>;
type PluginRpcCallArgs<Method extends PluginRpcMethodContract> = null extends PluginRpcCallInput<Method> ? [input?: PluginRpcCallInput<Method>] : [input: PluginRpcCallInput<Method>];
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
    params: JsonValue$1 | null;
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
    payload: JsonValue$1;
    createdAt: number;
    expiresAt: number | null;
}
interface PluginPendingInteractionProps {
    interaction: PluginPendingInteractionView;
    submit(value: JsonValue$1): Promise<void>;
    cancel(): Promise<void>;
}
/**
 * Props for a `sidebarFooterAction` — host-rendered (no plugin component).
 * Deliberately empty; the registration's `run` carries the behavior.
 */
interface PluginSidebarFooterActionProps {
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
    params?: JsonValue$1;
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
        params?: JsonValue$1;
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
interface PluginRpcClient<Contract extends PluginRpcContract = PluginRpcContract> {
    /**
     * Invoke one of the plugin's `bb.rpc` methods (POST
     * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
     * inferred output; rejects with an `Error` carrying the server's message,
     * stable `code`, and validation `issues` when present.
     */
    call<Method extends Extract<keyof Contract, string>>(method: Method, ...args: PluginRpcCallArgs<Contract[Method]>): Promise<PluginRpcResult<Contract[Method]>>;
}
interface PluginSettingsState {
    /**
     * Effective non-secret setting values (secret settings are excluded —
     * read them server-side). Undefined while loading or unavailable.
     */
    values: Record<string, string | boolean> | undefined;
    isLoading: boolean;
}
/** State of the app's shared realtime connection to the bb server. */
type PluginRealtimeConnectionState = "connecting" | "connected" | "reconnecting";
/** Where `useComposer()` writes: the active thread's draft or the new-thread draft. */
type PluginComposerScope = {
    kind: "thread";
    threadId: string;
} | {
    kind: "new-thread";
    projectId: string | null;
};
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
 * Programmatic access to the chat composer draft — the same shared draft the
 * built-in "Add to chat" affordances (file preview, diff, terminal selections)
 * write to. Inside a thread context writes land in that thread's draft;
 * anywhere else (nav panel, homepage section) they seed the new-thread
 * composer draft, which persists until the user sends or clears it.
 */
interface PluginComposerApi {
    scope: PluginComposerScope;
    /** Current plain text for this composer scope. */
    readonly text: string;
    /**
     * Replace the draft's plain text. Attachments are preserved. Inline mentions
     * outside the changed range are preserved and rebased; mentions overlapped
     * by the replacement are removed because their text representation changed.
     */
    setText(next: string): void;
    /**
     * Replace the draft's plain text from the latest committed value. Uses the
     * same structured-state reconciliation as `setText`.
     */
    updateText(updater: (current: string) => string): void;
    /** Clear plain text without clearing independently attached files. */
    clear(): void;
    /**
     * Append text to the draft as a `> ` blockquote block and focus the
     * composer. Blank text is a no-op. This is the "reference this selection
     * in chat" primitive.
     */
    addQuote(text: string): void;
    /**
     * Insert an @-mention pill that resolves through this plugin's mention
     * provider at send time — the durable way to reference an entity whose
     * content should be fetched fresh when the message is sent.
     */
    insertMention(mention: PluginComposerMention): void;
    /** Focus the composer caret at the end of the draft. */
    focus(): void;
}
/** Current app selection, derived from the route. */
interface BbContext {
    projectId: string | null;
    threadId: string | null;
}
interface BbNavigate {
    toThread(threadId: string): void;
    toProject(projectId: string): void;
    /**
     * Navigate to one of this plugin's own nav panels by its `path`.
     * `subPath` targets a location inside the panel (the component's
     * `subPath` prop); `replace` swaps the current history entry instead of
     * pushing — use it for redirects so back does not bounce.
     */
    toPluginPanel(path: string, options?: {
        subPath?: string;
        replace?: boolean;
    }): void;
    /**
     * Navigate to the root compose surface (the new-thread screen). Pass
     * `initialPrompt` to seed the composer draft and `focusPrompt` to focus the
     * composer on arrival — the pairing behind "Create via chat" style entry
     * points that drop the user into chat with a prefilled prompt.
     */
    toCompose(options?: {
        initialPrompt?: string;
        focusPrompt?: boolean;
    }): void;
}
/**
 * Everything `@bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
interface PluginSdkApp {
    definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
    useRpc<Contract extends PluginRpcContract = PluginRpcContract>(): PluginRpcClient<Contract>;
    useRealtime(channel: string, handler: (payload: unknown) => void): void;
    /**
     * Observe the same shared connection that delivers `useRealtime` signals.
     * Use a subsequent transition to `connected` to reconcile server state that
     * may have changed while ephemeral signals could not be delivered. The first
     * connection can transition from `connecting` and is not a reconnection.
     */
    useRealtimeConnectionState(): PluginRealtimeConnectionState;
    useSettings(): PluginSettingsState;
    useBbContext(): BbContext;
    useBbNavigate(): BbNavigate;
    useComposer(): PluginComposerApi;
}

/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
declare const appSettingsSchema: z$1.ZodObject<{
    caffeinate: z$1.ZodBoolean;
    showKeyboardHints: z$1.ZodBoolean;
    showUnhandledProviderEvents: z$1.ZodBoolean;
    codexMemoryEnabled: z$1.ZodBoolean;
    claudeCodeMemoryEnabled: z$1.ZodBoolean;
    codexSubagentsDisabled: z$1.ZodBoolean;
    claudeCodeSubagentsDisabled: z$1.ZodBoolean;
    claudeCodeWorkflowsDisabled: z$1.ZodBoolean;
}, z$1.core.$strict>;
type AppSettings = z$1.infer<typeof appSettingsSchema>;

declare const appKeybindingOverridesSchema: z$1.ZodArray<z$1.ZodObject<{
    command: z$1.ZodEnum<{
        "thread.jump.1": "thread.jump.1";
        "thread.jump.2": "thread.jump.2";
        "thread.jump.3": "thread.jump.3";
        "thread.jump.4": "thread.jump.4";
        "thread.jump.5": "thread.jump.5";
        "thread.jump.6": "thread.jump.6";
        "thread.jump.7": "thread.jump.7";
        "thread.jump.8": "thread.jump.8";
        "thread.jump.9": "thread.jump.9";
        "question.select.1": "question.select.1";
        "question.select.2": "question.select.2";
        "question.select.3": "question.select.3";
        "question.select.4": "question.select.4";
        "question.select.5": "question.select.5";
        "question.select.6": "question.select.6";
        "question.select.7": "question.select.7";
        "question.select.8": "question.select.8";
        "question.select.9": "question.select.9";
        "pane.focus.1": "pane.focus.1";
        "pane.focus.2": "pane.focus.2";
        "pane.focus.3": "pane.focus.3";
        "pane.focus.4": "pane.focus.4";
        "pane.focus.5": "pane.focus.5";
        "pane.focus.6": "pane.focus.6";
        "pane.focus.7": "pane.focus.7";
        "pane.focus.8": "pane.focus.8";
        "thread.new": "thread.new";
        "thread.search": "thread.search";
        "thread.previous": "thread.previous";
        "thread.next": "thread.next";
        "pane.focus.previous": "pane.focus.previous";
        "pane.focus.next": "pane.focus.next";
        "pane.maximize.toggle": "pane.maximize.toggle";
        "pane.close": "pane.close";
        "window.new": "window.new";
        "settings.open": "settings.open";
        "settings.openServers": "settings.openServers";
        "sidebar.toggle": "sidebar.toggle";
        "panel.newTab": "panel.newTab";
        "panel.close": "panel.close";
        "panel.toggle": "panel.toggle";
        "file.quickOpen": "file.quickOpen";
        "diff.toggle": "diff.toggle";
        "terminal.open": "terminal.open";
        "composer.focus": "composer.focus";
        "modelPicker.toggle": "modelPicker.toggle";
        "browser.focusLocation": "browser.focusLocation";
        "browser.reload": "browser.reload";
        "workspace.openPreferred": "workspace.openPreferred";
    }>;
    shortcut: z$1.ZodNullable<z$1.ZodObject<{
        key: z$1.ZodString;
        mod: z$1.ZodBoolean;
        meta: z$1.ZodBoolean;
        control: z$1.ZodBoolean;
        alt: z$1.ZodBoolean;
        shift: z$1.ZodBoolean;
    }, z$1.core.$strict>>;
}, z$1.core.$strict>>;
type AppKeybindingOverrides = z$1.infer<typeof appKeybindingOverridesSchema>;

declare const appThemeSchema: z$1.ZodObject<{
    themeId: z$1.ZodString;
    customCss: z$1.ZodNullable<z$1.ZodString>;
    faviconColor: z$1.ZodEnum<{
        default: "default";
        red: "red";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        teal: "teal";
        blue: "blue";
        purple: "purple";
        pink: "pink";
    }>;
}, z$1.core.$strip>;
type AppTheme = z$1.infer<typeof appThemeSchema>;
/**
 * The complete appearance selection a client sends when changing the palette
 * and/or favicon tint. The server validates `themeId` (built-in id or an
 * existing custom theme) and resolves the CSS from disk for custom themes.
 * Callers changing only one facet must carry the other facet forward explicitly.
 */
declare const appThemeSelectionSchema: z$1.ZodObject<{
    themeId: z$1.ZodString;
    faviconColor: z$1.ZodEnum<{
        default: "default";
        red: "red";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        teal: "teal";
        blue: "blue";
        purple: "purple";
        pink: "pink";
    }>;
}, z$1.core.$strip>;
type AppThemeSelection = z$1.infer<typeof appThemeSelectionSchema>;

declare const changedMessageSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"thread">;
    id: z$1.ZodOptional<z$1.ZodString>;
    metadata: z$1.ZodOptional<z$1.ZodObject<{
        backgroundActivityChanged: z$1.ZodOptional<z$1.ZodBoolean>;
        eventTypes: z$1.ZodOptional<z$1.ZodReadonly<z$1.ZodArray<z$1.ZodString & z$1.ZodType<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/warning" | "provider/modelFallback" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string, z$1.core.$ZodTypeInternals<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/warning" | "provider/modelFallback" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string>>>>>;
        hasPendingInteraction: z$1.ZodOptional<z$1.ZodBoolean>;
        projectId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "thread-created": "thread-created";
        "thread-deleted": "thread-deleted";
        "events-appended": "events-appended";
        "interactions-changed": "interactions-changed";
        "status-changed": "status-changed";
        "title-changed": "title-changed";
        "queue-changed": "queue-changed";
        "archived-changed": "archived-changed";
        "pin-state-changed": "pin-state-changed";
        "parent-changed": "parent-changed";
        "environment-changed": "environment-changed";
        "read-state-changed": "read-state-changed";
        "order-changed": "order-changed";
        "tabs-changed": "tabs-changed";
        "terminals-changed": "terminals-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"project">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "project-created": "project-created";
        "project-updated": "project-updated";
        "project-deleted": "project-deleted";
        "project-sources-changed": "project-sources-changed";
        "threads-changed": "threads-changed";
        "project-order-changed": "project-order-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"environment">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "status-changed": "status-changed";
        "environment-created": "environment-created";
        "environment-deleted": "environment-deleted";
        "metadata-changed": "metadata-changed";
        "work-status-changed": "work-status-changed";
        "git-refs-changed": "git-refs-changed";
        "thread-storage-changed": "thread-storage-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"host">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "host-connected": "host-connected";
        "host-disconnected": "host-disconnected";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"system">;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "config-changed": "config-changed";
        "plugins-changed": "plugins-changed";
    }>>>;
}, z$1.core.$strict>], "entity">;
type ChangedMessage = z$1.infer<typeof changedMessageSchema>;

declare const environmentSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodNullable<z$1.ZodString>;
    projectId: z$1.ZodString;
    hostId: z$1.ZodString;
    path: z$1.ZodNullable<z$1.ZodString>;
    managed: z$1.ZodBoolean;
    isGitRepo: z$1.ZodBoolean;
    isWorktree: z$1.ZodBoolean;
    workspaceProvisionType: z$1.ZodEnum<{
        unmanaged: "unmanaged";
        "managed-worktree": "managed-worktree";
        personal: "personal";
    }>;
    branchName: z$1.ZodNullable<z$1.ZodString>;
    baseBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        provisioning: "provisioning";
        ready: "ready";
        retiring: "retiring";
        destroying: "destroying";
        destroyed: "destroyed";
    }>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Environment = z$1.infer<typeof environmentSchema>;

/**
 * User-opt-in experiments (the Settings → Experiments toggles). Distinct from
 * `FeatureFlags`: flags are operator-set via env at server start, experiments
 * are user-toggled at runtime and persisted server-side so server-owned
 * policy (e.g. skill injection) can honor them.
 *
 * Every experiment defaults to off — opting in is the point.
 */
declare const experimentsSchema: z$1.ZodObject<{
    claudeCodeMockCliTraffic: z$1.ZodBoolean;
    plugins: z$1.ZodBoolean;
}, z$1.core.$strip>;
type Experiments = z$1.infer<typeof experimentsSchema>;

declare const hostSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    type: z$1.ZodEnum<{
        persistent: "persistent";
    }>;
    status: z$1.ZodEnum<{
        connected: "connected";
        disconnected: "disconnected";
    }>;
    lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Host = z$1.infer<typeof hostSchema>;

interface JsonObject {
    [key: string]: JsonValue;
}
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

declare const pendingInteractionResolutionSchema: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_once">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_for_session">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"deny">;
}, z$1.core.$strip>], "decision">, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"user_answer">;
    answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        selected: z$1.ZodArray<z$1.ZodString>;
        freeText: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"plugin_submitted">;
}, z$1.core.$strip>]>;
type PendingInteractionResolution = z$1.infer<typeof pendingInteractionResolutionSchema>;
declare const providerPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodUnion<readonly [z$1.ZodObject<{
        kind: z$1.ZodLiteral<"approval">;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            itemId: z$1.ZodString;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                type: z$1.ZodLiteral<"read">;
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"listFiles">;
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"search">;
                command: z$1.ZodString;
                query: z$1.ZodNullable<z$1.ZodString>;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"unknown">;
                command: z$1.ZodString;
            }, z$1.core.$strip>], "type">>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"file_change">;
            itemId: z$1.ZodString;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"permission_grant">;
            itemId: z$1.ZodString;
            toolName: z$1.ZodNullable<z$1.ZodString>;
            permissions: z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strip>], "kind">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_once: "allow_once";
            allow_for_session: "allow_for_session";
            deny: "deny";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>;
    resolution: z$1.ZodNullable<z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>>;
}, z$1.core.$strip>;
type ProviderPendingInteraction = z$1.infer<typeof providerPendingInteractionSchema>;
declare const pluginPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
        data: z$1.ZodType<JsonValue, unknown, z$1.core.$ZodTypeInternals<JsonValue, unknown>>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginPendingInteraction = z$1.infer<typeof pluginPendingInteractionSchema>;
type PendingInteraction = ProviderPendingInteraction | PluginPendingInteraction;

declare const projectSourceSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    isDefault: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    type: z$1.ZodLiteral<"local_path">;
    hostId: z$1.ZodString;
    path: z$1.ZodString;
}, z$1.core.$strip>;
type ProjectSource = z$1.infer<typeof projectSourceSchema>;

declare const resolvedThreadExecutionOptionsSchema: z$1.ZodObject<{
    seq: z$1.ZodOptional<z$1.ZodNumber>;
    model: z$1.ZodString;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>;
    source: z$1.ZodEnum<{
        "client/thread/start": "client/thread/start";
        "client/turn/requested": "client/turn/requested";
        "client/turn/start": "client/turn/start";
    }>;
}, z$1.core.$strip>;
type ResolvedThreadExecutionOptions = z$1.infer<typeof resolvedThreadExecutionOptionsSchema>;
declare const projectExecutionDefaultsSchema: z$1.ZodObject<{
    providerId: z$1.ZodString;
    model: z$1.ZodString;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>;
}, z$1.core.$strip>;
type ProjectExecutionDefaults = z$1.infer<typeof projectExecutionDefaultsSchema>;

/** All thread events — provider-originated or system-originated. */
declare const threadEventSchema: z$1.ZodPipe<z$1.ZodUnknown, z$1.ZodUnion<readonly [z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/started">;
    threadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/identity">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/started">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    error: z$1.ZodOptional<z$1.ZodObject<{
        message: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/input/accepted">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    clientRequestId: z$1.ZodString;
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/name/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    threadName: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/compacted">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/goal/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    objective: z$1.ZodString;
    status: z$1.ZodEnum<{
        active: "active";
        paused: "paused";
        budgetLimited: "budgetLimited";
        complete: "complete";
    }>;
    tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
    tokensUsed: z$1.ZodNumber;
    timeUsedSeconds: z$1.ZodNumber;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/goal/cleared">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/started">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"userMessage">;
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"agentMessage">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commandExecution">;
        id: z$1.ZodString;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"fileChange">;
        id: z$1.ZodString;
        changes: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            diff: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webSearch">;
        id: z$1.ZodString;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webFetch">;
        id: z$1.ZodString;
        url: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"imageView">;
        id: z$1.ZodString;
        path: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"toolCall">;
        id: z$1.ZodString;
        server: z$1.ZodOptional<z$1.ZodString>;
        tool: z$1.ZodString;
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        error: z$1.ZodOptional<z$1.ZodString>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"reasoning">;
        id: z$1.ZodString;
        summary: z$1.ZodArray<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"plan">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"contextCompaction">;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"userMessage">;
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"agentMessage">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commandExecution">;
        id: z$1.ZodString;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"fileChange">;
        id: z$1.ZodString;
        changes: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            diff: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webSearch">;
        id: z$1.ZodString;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webFetch">;
        id: z$1.ZodString;
        url: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"imageView">;
        id: z$1.ZodString;
        path: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"toolCall">;
        id: z$1.ZodString;
        server: z$1.ZodOptional<z$1.ZodString>;
        tool: z$1.ZodString;
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        error: z$1.ZodOptional<z$1.ZodString>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"reasoning">;
        id: z$1.ZodString;
        summary: z$1.ZodArray<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"plan">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"contextCompaction">;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/agentMessage/delta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/commandExecution/outputDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    reset: z$1.ZodOptional<z$1.ZodBoolean>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/fileChange/outputDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/reasoning/summaryTextDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/reasoning/textDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/plan/delta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/mcpToolCall/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/toolCall/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/backgroundTask/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/backgroundTask/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
            pending: "pending";
        }>;
        taskStatus: z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            paused: "paused";
            pending: "pending";
            running: "running";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    failed: "failed";
                    running: "running";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/tokenUsage/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    tokenUsage: z$1.ZodObject<{
        total: z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            cachedInputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        last: z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            cachedInputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/contextWindowUsage/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    contextWindowUsage: z$1.ZodObject<{
        usedTokens: z$1.ZodNullable<z$1.ZodNumber>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
        estimated: z$1.ZodBoolean;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/plan/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    plan: z$1.ZodArray<z$1.ZodObject<{
        step: z$1.ZodString;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            active: "active";
            pending: "pending";
        }>>;
    }, z$1.core.$strip>>;
    explanation: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/diff/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    diff: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/error">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    message: z$1.ZodString;
    detail: z$1.ZodOptional<z$1.ZodString>;
    willRetry: z$1.ZodOptional<z$1.ZodBoolean>;
    errorInfo: z$1.ZodOptional<z$1.ZodObject<{
        category: z$1.ZodEnum<{
            unknown: "unknown";
            "active-turn-not-steerable": "active-turn-not-steerable";
            "bad-request": "bad-request";
            "connection-failed": "connection-failed";
            "context-window-exceeded": "context-window-exceeded";
            billing: "billing";
            "budget-exceeded": "budget-exceeded";
            internal: "internal";
            "max-output-tokens": "max-output-tokens";
            "max-turns": "max-turns";
            overloaded: "overloaded";
            policy: "policy";
            "rate-limit": "rate-limit";
            sandbox: "sandbox";
            "stream-disconnected": "stream-disconnected";
            "structured-output-retries": "structured-output-retries";
            "thread-rollback-failed": "thread-rollback-failed";
            "too-many-failed-attempts": "too-many-failed-attempts";
            unauthorized: "unauthorized";
        }>;
        providerCode: z$1.ZodNullable<z$1.ZodString>;
        httpStatusCode: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/warning">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    category: z$1.ZodEnum<{
        deprecation: "deprecation";
        config: "config";
        general: "general";
    }>;
    summary: z$1.ZodOptional<z$1.ZodString>;
    details: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/modelFallback">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    originalModel: z$1.ZodString;
    fallbackModel: z$1.ZodString;
    reason: z$1.ZodEnum<{
        refusal: "refusal";
        provider: "provider";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/unhandled">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerId: z$1.ZodString;
    rawType: z$1.ZodString;
    rawEvent: z$1.ZodObject<{
        jsonrpc: z$1.ZodLiteral<"2.0">;
        id: z$1.ZodOptional<z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodNumber]>>;
        method: z$1.ZodString;
        params: z$1.ZodOptional<z$1.ZodType<JsonValue, unknown, z$1.core.$ZodTypeInternals<JsonValue, unknown>>>;
    }, z$1.core.$strip>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>], "type">, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>, z$1.ZodIntersection<z$1.ZodUnion<readonly [z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/thread/start">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        system: "system";
        user: "user";
        agent: "agent";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/requested">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    requestId: z$1.ZodString;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        system: "system";
        user: "user";
        agent: "agent";
    }>;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    systemMessageKind: z$1.ZodOptional<z$1.ZodEnum<{
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        "child-needs-attention": "child-needs-attention";
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-outcome-batch": "child-outcome-batch";
        unlabeled: "unlabeled";
    }>>;
    systemMessageSubject: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-batch">;
        count: z$1.ZodNumber;
    }, z$1.core.$strip>], "kind">>>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>>>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-start">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"new-turn">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"auto">;
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"steer">;
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>], "kind">;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
    execution: z$1.ZodObject<{
        seq: z$1.ZodOptional<z$1.ZodNumber>;
        model: z$1.ZodString;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            "workspace-write": "workspace-write";
        }>;
        source: z$1.ZodEnum<{
            "client/thread/start": "client/thread/start";
            "client/turn/requested": "client/turn/requested";
            "client/turn/start": "client/turn/start";
        }>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/start">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        system: "system";
        user: "user";
        agent: "agent";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/error">;
    threadId: z$1.ZodString;
    code: z$1.ZodOptional<z$1.ZodString>;
    message: z$1.ZodString;
    detail: z$1.ZodOptional<z$1.ZodString>;
    reconnectAttempt: z$1.ZodOptional<z$1.ZodNumber>;
    reconnectTotal: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/manager/user_message">;
    threadId: z$1.ZodString;
    text: z$1.ZodString;
    toolCallId: z$1.ZodOptional<z$1.ZodString>;
    turnId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/thread/interrupted">;
    threadId: z$1.ZodString;
    reason: z$1.ZodEnum<{
        "manual-stop": "manual-stop";
        "host-daemon-restarted": "host-daemon-restarted";
        "provider-turn-idle": "provider-turn-idle";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/operation">;
    threadId: z$1.ZodString;
    operation: z$1.ZodString;
    status: z$1.ZodString;
    message: z$1.ZodString;
    operationId: z$1.ZodString;
    metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue, unknown, z$1.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/permissionGrant/lifecycle">;
    threadId: z$1.ZodString;
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">>>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    subject: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"permission_grant">;
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
        permissions: z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/userQuestion/lifecycle">;
    threadId: z$1.ZodString;
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    status: z$1.ZodEnum<{
        interrupted: "interrupted";
        pending: "pending";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/thread-provisioning">;
    threadId: z$1.ZodString;
    provisioningId: z$1.ZodString;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        active: "active";
        cancelled: "cancelled";
    }>;
    environmentId: z$1.ZodString;
    entries: z$1.ZodArray<z$1.ZodObject<{
        type: z$1.ZodEnum<{
            output: "output";
            step: "step";
        }>;
        key: z$1.ZodString;
        text: z$1.ZodString;
        startedAt: z$1.ZodOptional<z$1.ZodNumber>;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
        }>>;
        metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/provider-turn-watchdog">;
    threadId: z$1.ZodString;
    reason: z$1.ZodLiteral<"provider-turn-idle">;
    thresholdMs: z$1.ZodNumber;
    elapsedMs: z$1.ZodNumber;
    activeTurnId: z$1.ZodString;
    activeTurnStartedAt: z$1.ZodNumber;
    lastActivityEventSequence: z$1.ZodNumber;
    lastActivityEventType: z$1.ZodString;
    lastActivityEventAt: z$1.ZodNumber;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    firedAt: z$1.ZodNumber;
}, z$1.core.$strip>]>, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>]>>;
type ThreadEvent = z$1.infer<typeof threadEventSchema>;
type ThreadEventType = ThreadEvent["type"];

declare const providerInfoSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    displayName: z$1.ZodString;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    capabilities: z$1.ZodObject<{
        supportsArchive: z$1.ZodBoolean;
        supportsRename: z$1.ZodBoolean;
        supportsServiceTier: z$1.ZodBoolean;
        supportsUserQuestion: z$1.ZodBoolean;
        supportsFork: z$1.ZodBoolean;
        supportedPermissionModes: z$1.ZodArray<z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            "workspace-write": "workspace-write";
        }>>;
    }, z$1.core.$strip>;
    composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"skills">;
        trigger: z$1.ZodEnum<{
            "/": "/";
        }>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plan">;
        command: z$1.ZodObject<{
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"goal">;
        command: z$1.ZodObject<{
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>], "kind">>;
    available: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ProviderInfo = z$1.infer<typeof providerInfoSchema>;

declare const threadEventScopeSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    kind: z$1.ZodLiteral<"thread">;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"turn">;
    turnId: z$1.ZodString;
}, z$1.core.$strip>], "kind">;
type ThreadEventScope = z$1.infer<typeof threadEventScopeSchema>;

type ThreadEventByType = {
    [TType in ThreadEventType]: Extract<ThreadEvent, {
        type: TType;
    }>;
};
type ThreadEventForType<TType extends ThreadEventType> = ThreadEventByType[TType];
type StoredThreadEventDataFromEvent<TEvent extends ThreadEvent> = Omit<TEvent, "threadId" | "type" | "scope">;
interface ThreadEventRowBase {
    id: string;
    scope: ThreadEventScope;
    threadId: string;
    seq: number;
    createdAt: number;
}
type ThreadEventRowFromEvent<TEvent extends ThreadEvent> = ThreadEventRowBase & {
    type: TEvent["type"];
    data: StoredThreadEventDataFromEvent<TEvent>;
};
type ThreadEventRowOfType<TType extends ThreadEventType> = ThreadEventRowFromEvent<ThreadEventForType<TType>>;
type ThreadEventRow = {
    [TType in ThreadEventType]: ThreadEventRowOfType<TType>;
}[ThreadEventType];

declare const threadStatusSchema: z$1.ZodEnum<{
    error: "error";
    active: "active";
    starting: "starting";
    idle: "idle";
    stopping: "stopping";
}>;
type ThreadStatus = z$1.infer<typeof threadStatusSchema>;

declare const threadTimelinePendingTodosSchema: z$1.ZodObject<{
    sourceSeq: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    items: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        text: z$1.ZodString;
        status: z$1.ZodEnum<{
            completed: "completed";
            pending: "pending";
            in_progress: "in_progress";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThreadTimelinePendingTodos = z$1.infer<typeof threadTimelinePendingTodosSchema>;

declare const threadQueuedMessageSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodString;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    groupWithNext: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadQueuedMessage = z$1.infer<typeof threadQueuedMessageSchema>;

declare const workspaceFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspaceFileListResponse = z$1.infer<typeof workspaceFileListResponseSchema>;
declare const workspacePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        path: z$1.ZodString;
        name: z$1.ZodString;
        score: z$1.ZodNumber;
        positions: z$1.ZodArray<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspacePathListResponse = z$1.infer<typeof workspacePathListResponseSchema>;

declare const createProjectSourceRequestSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"local_path">;
    path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"clone">;
    targetPath: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    remoteUrl: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>], "type">;
type CreateProjectSourceRequest = z$1.infer<typeof createProjectSourceRequestSchema>;
declare const createProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
    source: z$1.ZodObject<{
        hostId: z$1.ZodString;
        type: z$1.ZodLiteral<"local_path">;
        path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
    }, z$1.core.$strict>;
}, z$1.core.$strip>;
type CreateProjectRequest = z$1.infer<typeof createProjectRequestSchema>;
declare const threadSectionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadSectionResponse = z$1.infer<typeof threadSectionSchema>;
declare const createThreadSectionRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
}, z$1.core.$strict>;
type CreateThreadSectionRequest = z$1.infer<typeof createThreadSectionRequestSchema>;
declare const updateThreadSectionRequestSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateThreadSectionRequest = z$1.infer<typeof updateThreadSectionRequestSchema>;
declare const deleteThreadSectionRequestSchema: z$1.ZodObject<{
    id: z$1.ZodString;
}, z$1.core.$strict>;
type DeleteThreadSectionRequest = z$1.infer<typeof deleteThreadSectionRequestSchema>;
declare const threadSectionMutationResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    updatedThreadCount: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadSectionMutationResponse = z$1.infer<typeof threadSectionMutationResponseSchema>;
declare const reorderProjectRequestSchema: z$1.ZodObject<{
    previousProjectId: z$1.ZodNullable<z$1.ZodString>;
    nextProjectId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderProjectRequest = z$1.infer<typeof reorderProjectRequestSchema>;
declare const projectListQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
    includePersonal: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
}, z$1.core.$strip>;
type ProjectListQuery = z$1.infer<typeof projectListQuerySchema>;
declare const projectFilesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectFilesQuery = z$1.infer<typeof projectFilesQuerySchema>;
declare const projectPathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectPathsQuery = z$1.infer<typeof projectPathsQuerySchema>;
declare const projectFileContentQuerySchema: z$1.ZodObject<{
    path: z$1.ZodString;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectFileContentQuery = z$1.infer<typeof projectFileContentQuerySchema>;
declare const projectBranchesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodString;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectBranchesQuery = z$1.infer<typeof projectBranchesQuerySchema>;
declare const projectBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"branch">;
        branchName: z$1.ZodString;
        headSha: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"detached">;
        headSha: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unborn">;
        branchName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
        unknown: "unknown";
        equal: "equal";
        "local-behind": "local-behind";
        "local-ahead": "local-ahead";
        diverged: "diverged";
    }>>;
    hasUncommittedChanges: z$1.ZodBoolean;
    operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"none">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"merge">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"rebase">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"cherry-pick">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"revert">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>], "kind">;
    originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        kind: z$1.ZodEnum<{
            local: "local";
            remote: "remote";
            missing: "missing";
        }>;
    }, z$1.core.$strip>>;
    defaultWorktreeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectBranchesResponse = z$1.infer<typeof projectBranchesResponseSchema>;
declare const promptHistoryQuerySchema: z$1.ZodObject<{
    limit: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PromptHistoryQuery = z$1.infer<typeof promptHistoryQuerySchema>;
declare const promptHistoryResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    id: z$1.ZodString;
    createdAt: z$1.ZodNumber;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>>;
type PromptHistoryResponse = z$1.infer<typeof promptHistoryResponseSchema>;
declare const updateProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type UpdateProjectRequest = z$1.infer<typeof updateProjectRequestSchema>;
declare const updateProjectSourceRequestSchema: z$1.ZodObject<{
    type: z$1.ZodLiteral<"local_path">;
    path: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    isDefault: z$1.ZodOptional<z$1.ZodLiteral<true>>;
}, z$1.core.$strict>;
type UpdateProjectSourceRequest = z$1.infer<typeof updateProjectSourceRequestSchema>;
declare const commandListResponseSchema: z$1.ZodObject<{
    commands: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        source: z$1.ZodEnum<{
            command: "command";
            skill: "skill";
        }>;
        origin: z$1.ZodEnum<{
            user: "user";
            project: "project";
            builtin: "builtin";
        }>;
        description: z$1.ZodNullable<z$1.ZodString>;
        argumentHint: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type CommandListResponse = z$1.infer<typeof commandListResponseSchema>;
/** Query for the complete command catalog available to a project and provider. */
declare const projectCommandsQuerySchema: z$1.ZodObject<{
    provider: z$1.ZodString;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strict>;
type ProjectCommandsQuery = z$1.infer<typeof projectCommandsQuerySchema>;
declare const projectResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        standard: "standard";
        personal: "personal";
    }>;
    name: z$1.ZodString;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    sources: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        projectId: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        type: z$1.ZodLiteral<"local_path">;
        hostId: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProjectResponse = z$1.infer<typeof projectResponseSchema>;
declare const projectWithThreadsResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        standard: "standard";
        personal: "personal";
    }>;
    name: z$1.ZodString;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    sources: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        projectId: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        type: z$1.ZodLiteral<"local_path">;
        hostId: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
    threads: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        projectId: z$1.ZodString;
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        providerId: z$1.ZodString;
        title: z$1.ZodNullable<z$1.ZodString>;
        titleFallback: z$1.ZodNullable<z$1.ZodString>;
        sectionId: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
        }>;
        parentThreadId: z$1.ZodNullable<z$1.ZodString>;
        sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
        originKind: z$1.ZodNullable<z$1.ZodEnum<{
            "side-chat": "side-chat";
            fork: "fork";
        }>>;
        childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
            "side-chat": "side-chat";
            fork: "fork";
        }>>;
        originPluginId: z$1.ZodNullable<z$1.ZodString>;
        visibility: z$1.ZodEnum<{
            visible: "visible";
            hidden: "hidden";
        }>;
        archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
        pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
        deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
        latestAttentionAt: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        runtime: z$1.ZodObject<{
            displayStatus: z$1.ZodEnum<{
                error: "error";
                provisioning: "provisioning";
                stopping: "stopping";
                idle: "idle";
                starting: "starting";
                active: "active";
                "host-reconnecting": "host-reconnecting";
                "waiting-for-host": "waiting-for-host";
            }>;
            hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
        }, z$1.core.$strip>;
        activity: z$1.ZodObject<{
            activeWorkflowCount: z$1.ZodNumber;
            activeBackgroundAgentCount: z$1.ZodNumber;
            activeBackgroundCommandCount: z$1.ZodNumber;
            activePlanModeCount: z$1.ZodNumber;
            activeGoalCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        pinSortKey: z$1.ZodNullable<z$1.ZodString>;
        hasPendingInteraction: z$1.ZodBoolean;
        environmentHostId: z$1.ZodNullable<z$1.ZodString>;
        environmentName: z$1.ZodNullable<z$1.ZodString>;
        environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
        environmentWorkspaceDisplayKind: z$1.ZodEnum<{
            "managed-worktree": "managed-worktree";
            "unmanaged-worktree": "unmanaged-worktree";
            other: "other";
        }>;
    }, z$1.core.$strip>>;
    defaultExecutionOptions: z$1.ZodNullable<z$1.ZodObject<{
        providerId: z$1.ZodString;
        model: z$1.ZodString;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            "workspace-write": "workspace-write";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProjectWithThreadsResponse = z$1.infer<typeof projectWithThreadsResponseSchema>;
declare const uploadedPromptAttachmentSchema: z$1.ZodObject<{
    type: z$1.ZodEnum<{
        localImage: "localImage";
        localFile: "localFile";
    }>;
    path: z$1.ZodString;
    name: z$1.ZodString;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    sizeBytes: z$1.ZodNumber;
}, z$1.core.$strip>;
type UploadedPromptAttachment = z$1.infer<typeof uploadedPromptAttachmentSchema>;
declare const copyProjectAttachmentsRequestSchema: z$1.ZodObject<{
    sourceProjectId: z$1.ZodString;
    paths: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strict>;
type CopyProjectAttachmentsRequest = z$1.infer<typeof copyProjectAttachmentsRequestSchema>;

declare const updateEnvironmentRequestSchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    name: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
}, z$1.core.$strip>;
type UpdateEnvironmentRequest = z$1.infer<typeof updateEnvironmentRequestSchema>;
/**
 * Query for searching paths in an environment's workspace. Unlike the
 * project-scoped variant this needs no `environmentId` — the environment is
 * the route param — and is project-agnostic, so it works for projectless
 * (personal) environments too.
 */
declare const environmentPathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
}, z$1.core.$strip>;
type EnvironmentPathsQuery = z$1.infer<typeof environmentPathsQuerySchema>;
declare const environmentDiffBranchesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesQuery = z$1.infer<typeof environmentDiffBranchesQuerySchema>;
declare const environmentDiffBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        kind: z$1.ZodEnum<{
            local: "local";
            remote: "remote";
            missing: "missing";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesResponse = z$1.infer<typeof environmentDiffBranchesResponseSchema>;
declare const environmentStatusQuerySchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodString>>;
}, z$1.core.$strip>;
type EnvironmentStatusQuery = z$1.infer<typeof environmentStatusQuerySchema>;
declare const environmentDiffQuerySchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    target: z$1.ZodLiteral<"uncommitted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"branch_committed">;
    mergeBaseBranch: z$1.ZodPipe<z$1.ZodString, z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"all">;
    mergeBaseBranch: z$1.ZodPipe<z$1.ZodString, z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"commit">;
    sha: z$1.ZodString;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffQuery = z$1.infer<typeof environmentDiffQuerySchema>;
/**
 * Query for fetching a single file's contents at one side of a diff target.
 * Used by the diff card to reparse the card's patch with full old/new contents
 * so `@pierre/diffs` can render expand-context buttons between hunks.
 *
 * For `branch_committed` / `all`, callers pass the resolved merge-base SHA
 * (`mergeBaseRef`, surfaced by `workspace.diff`) rather than the branch name
 * — the diff itself was computed against that SHA, so reading the old side
 * from the same SHA keeps the file content aligned with the hunk line
 * numbers. Reading from the branch tip is wrong whenever the branch has
 * moved past the merge-base since the file existed there.
 */
declare const environmentDiffFileQuerySchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    target: z$1.ZodLiteral<"uncommitted">;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        old: "old";
        new: "new";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"branch_committed">;
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        old: "old";
        new: "new";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"all">;
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        old: "old";
        new: "new";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"commit">;
    sha: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        old: "old";
        new: "new";
    }>;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffFileQuery = z$1.infer<typeof environmentDiffFileQuerySchema>;
declare const environmentDiffFileResponseSchema: z$1.ZodObject<{
    path: z$1.ZodString;
    content: z$1.ZodString;
    contentEncoding: z$1.ZodEnum<{
        base64: "base64";
        utf8: "utf8";
    }>;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    sizeBytes: z$1.ZodNumber;
}, z$1.core.$strip>;
type EnvironmentDiffFileResponse = z$1.infer<typeof environmentDiffFileResponseSchema>;
declare const environmentArchiveThreadsResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    archivedThreadIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentArchiveThreadsResponse = z$1.infer<typeof environmentArchiveThreadsResponseSchema>;
declare const pullRequestMergeMethodSchema: z$1.ZodEnum<{
    merge: "merge";
    rebase: "rebase";
    squash: "squash";
}>;
type PullRequestMergeMethod = z$1.infer<typeof pullRequestMergeMethodSchema>;
declare const commitActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"commit">;
    message: z$1.ZodString;
    commitSha: z$1.ZodString;
    commitSubject: z$1.ZodString;
}, z$1.core.$strip>;
type CommitActionResponse = z$1.infer<typeof commitActionResponseSchema>;
declare const squashMergeActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"squash_merge">;
    merged: z$1.ZodBoolean;
    message: z$1.ZodString;
    commitSha: z$1.ZodString;
    commitSubject: z$1.ZodString;
}, z$1.core.$strip>;
type SquashMergeActionResponse = z$1.infer<typeof squashMergeActionResponseSchema>;
declare const pullRequestReadyActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"pull_request_ready">;
    message: z$1.ZodString;
}, z$1.core.$strip>;
type PullRequestReadyActionResponse = z$1.infer<typeof pullRequestReadyActionResponseSchema>;
declare const pullRequestMergeActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"pull_request_merge">;
    method: z$1.ZodEnum<{
        merge: "merge";
        rebase: "rebase";
        squash: "squash";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>;
type PullRequestMergeActionResponse = z$1.infer<typeof pullRequestMergeActionResponseSchema>;
declare const pullRequestDraftActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"pull_request_draft">;
    message: z$1.ZodString;
}, z$1.core.$strip>;
type PullRequestDraftActionResponse = z$1.infer<typeof pullRequestDraftActionResponseSchema>;
declare const environmentStatusResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    workspace: z$1.ZodObject<{
        workingTree: z$1.ZodObject<{
            insertions: z$1.ZodNumber;
            deletions: z$1.ZodNumber;
            files: z$1.ZodArray<z$1.ZodObject<{
                path: z$1.ZodString;
                status: z$1.ZodEnum<{
                    M: "M";
                    A: "A";
                    D: "D";
                    R: "R";
                    C: "C";
                    U: "U";
                    "??": "??";
                    "?": "?";
                }>;
                insertions: z$1.ZodNullable<z$1.ZodNumber>;
                deletions: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            hasUncommittedChanges: z$1.ZodBoolean;
            state: z$1.ZodEnum<{
                clean: "clean";
                untracked: "untracked";
                dirty_uncommitted: "dirty_uncommitted";
                committed_unmerged: "committed_unmerged";
                dirty_and_committed_unmerged: "dirty_and_committed_unmerged";
            }>;
        }, z$1.core.$strip>;
        checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"branch">;
            branchName: z$1.ZodString;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"detached">;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unborn">;
            branchName: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        branch: z$1.ZodObject<{
            currentBranch: z$1.ZodNullable<z$1.ZodString>;
            defaultBranch: z$1.ZodString;
        }, z$1.core.$strip>;
        mergeBase: z$1.ZodNullable<z$1.ZodObject<{
            insertions: z$1.ZodNumber;
            deletions: z$1.ZodNumber;
            files: z$1.ZodArray<z$1.ZodObject<{
                path: z$1.ZodString;
                status: z$1.ZodEnum<{
                    M: "M";
                    A: "A";
                    D: "D";
                    R: "R";
                    C: "C";
                    U: "U";
                    "??": "??";
                    "?": "?";
                }>;
                insertions: z$1.ZodNullable<z$1.ZodNumber>;
                deletions: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            mergeBaseBranch: z$1.ZodString;
            baseRef: z$1.ZodNullable<z$1.ZodString>;
            aheadCount: z$1.ZodNumber;
            behindCount: z$1.ZodNumber;
            hasCommittedUnmergedChanges: z$1.ZodBoolean;
            commits: z$1.ZodArray<z$1.ZodObject<{
                sha: z$1.ZodString;
                shortSha: z$1.ZodString;
                subject: z$1.ZodString;
                authorName: z$1.ZodString;
                authoredAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
/**
 * Structured pull-request lookup outcome. "absent" is a real answer — the
 * host checked and the branch has no PR (non-git environments resolve to
 * "absent" without a daemon call). "unavailable" means the lookup itself
 * failed (gh missing, not authenticated, timeout, unreachable workspace), so
 * callers must not render it as "no PR exists".
 */
declare const environmentPullRequestResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    pullRequest: z$1.ZodObject<{
        number: z$1.ZodNumber;
        title: z$1.ZodString;
        state: z$1.ZodEnum<{
            merged: "merged";
            draft: "draft";
            open: "open";
            closed: "closed";
        }>;
        url: z$1.ZodString;
        baseRefName: z$1.ZodString;
        headRefName: z$1.ZodString;
        updatedAt: z$1.ZodString;
        checks: z$1.ZodObject<{
            state: z$1.ZodEnum<{
                unknown: "unknown";
                pending: "pending";
                passing: "passing";
                failing: "failing";
                no_checks: "no_checks";
            }>;
            totalCount: z$1.ZodNumber;
            passedCount: z$1.ZodNumber;
            failedCount: z$1.ZodNumber;
            pendingCount: z$1.ZodNumber;
        }, z$1.core.$strict>;
        review: z$1.ZodObject<{
            state: z$1.ZodEnum<{
                none: "none";
                approved: "approved";
                changes_requested: "changes_requested";
                review_required: "review_required";
                review_requested: "review_requested";
            }>;
            reviewRequestCount: z$1.ZodNumber;
        }, z$1.core.$strict>;
        mergeability: z$1.ZodObject<{
            state: z$1.ZodEnum<{
                unknown: "unknown";
                draft: "draft";
                mergeable: "mergeable";
                conflicts: "conflicts";
                blocked: "blocked";
            }>;
            mergeStateStatus: z$1.ZodNullable<z$1.ZodEnum<{
                BEHIND: "BEHIND";
                BLOCKED: "BLOCKED";
                CLEAN: "CLEAN";
                DIRTY: "DIRTY";
                DRAFT: "DRAFT";
                HAS_HOOKS: "HAS_HOOKS";
                UNKNOWN: "UNKNOWN";
                UNSTABLE: "UNSTABLE";
            }>>;
            mergeable: z$1.ZodNullable<z$1.ZodEnum<{
                UNKNOWN: "UNKNOWN";
                CONFLICTING: "CONFLICTING";
                MERGEABLE: "MERGEABLE";
            }>>;
        }, z$1.core.$strict>;
        attention: z$1.ZodEnum<{
            none: "none";
            merged: "merged";
            draft: "draft";
            closed: "closed";
            changes_requested: "changes_requested";
            review_requested: "review_requested";
            conflicts: "conflicts";
            blocked: "blocked";
            checks_failed: "checks_failed";
            checks_pending: "checks_pending";
            ready_to_merge: "ready_to_merge";
        }>;
    }, z$1.core.$strict>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"absent">;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    message: z$1.ZodString;
}, z$1.core.$strict>], "outcome">;
type EnvironmentPullRequestResponse = z$1.infer<typeof environmentPullRequestResponseSchema>;
declare const environmentDiffResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    diff: z$1.ZodObject<{
        diff: z$1.ZodString;
        truncated: z$1.ZodBoolean;
        shortstat: z$1.ZodString;
        files: z$1.ZodString;
        mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffResponse = z$1.infer<typeof environmentDiffResponseSchema>;
declare const environmentDiffFilesResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        previousPath: z$1.ZodNullable<z$1.ZodString>;
        changeKind: z$1.ZodEnum<{
            deleted: "deleted";
            added: "added";
            modified: "modified";
            renamed: "renamed";
            copied: "copied";
            type_changed: "type_changed";
        }>;
        additions: z$1.ZodNumber;
        deletions: z$1.ZodNumber;
        binary: z$1.ZodBoolean;
        origin: z$1.ZodEnum<{
            untracked: "untracked";
            tracked: "tracked";
        }>;
        loadMode: z$1.ZodEnum<{
            auto: "auto";
            on_demand: "on_demand";
            too_large: "too_large";
        }>;
    }, z$1.core.$strip>>;
    shortstat: z$1.ZodString;
    mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    initialPatches: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        patch: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
        too_many_files: "too_many_files";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffFilesResponse = z$1.infer<typeof environmentDiffFilesResponseSchema>;
declare const environmentDiffPatchResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    patches: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        patch: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffPatchResponse = z$1.infer<typeof environmentDiffPatchResponseSchema>;
/**
 * Body for `POST /diff/patch`: the diff target plus the list of new paths whose
 * patches the client wants. A POST (not GET) because the repeated `paths` array
 * cannot survive flat query parsing. The client supplies only new paths; the
 * server re-derives each file's rename/copy pairing (`previousPath`) from its
 * own TOC.
 */
declare const environmentDiffPatchRequestSchema: z$1.ZodObject<{
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"uncommitted">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"branch_committed">;
        mergeBaseBranch: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"all">;
        mergeBaseBranch: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commit">;
        sha: z$1.ZodString;
    }, z$1.core.$strip>], "type">;
    paths: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strict>;
type EnvironmentDiffPatchRequest = z$1.infer<typeof environmentDiffPatchRequestSchema>;
type EnvironmentStatusResponse = z$1.infer<typeof environmentStatusResponseSchema>;

declare const providerUsageResponseSchema: z$1.ZodObject<{
    codex: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        status: z$1.ZodLiteral<"ok">;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodString;
            usedPercent: z$1.ZodNumber;
            resetsAt: z$1.ZodNullable<z$1.ZodString>;
            cost: z$1.ZodOptional<z$1.ZodObject<{
                usedUsdCents: z$1.ZodNumber;
                limitUsdCents: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"not_installed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"unauthenticated">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"expired">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"error">;
        message: z$1.ZodString;
    }, z$1.core.$strip>], "status">;
    claudeCode: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        status: z$1.ZodLiteral<"ok">;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodString;
            usedPercent: z$1.ZodNumber;
            resetsAt: z$1.ZodNullable<z$1.ZodString>;
            cost: z$1.ZodOptional<z$1.ZodObject<{
                usedUsdCents: z$1.ZodNumber;
                limitUsdCents: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"not_installed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"unauthenticated">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"expired">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"error">;
        message: z$1.ZodString;
    }, z$1.core.$strip>], "status">;
    cursor: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        status: z$1.ZodLiteral<"ok">;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodString;
            usedPercent: z$1.ZodNumber;
            resetsAt: z$1.ZodNullable<z$1.ZodString>;
            cost: z$1.ZodOptional<z$1.ZodObject<{
                usedUsdCents: z$1.ZodNumber;
                limitUsdCents: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"not_installed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"unauthenticated">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"expired">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"error">;
        message: z$1.ZodString;
    }, z$1.core.$strip>], "status">;
}, z$1.core.$strip>;
type ProviderUsageResponse = z$1.infer<typeof providerUsageResponseSchema>;
type HostDaemonCommandTransport = "settled" | "onlineRpc";
type HostDaemonCommandEnvironmentLane = "read" | "write";
type HostDaemonFlushEventsBeforeResult = boolean | "when-initiated";
interface HostDaemonCommandDescriptor<Type extends string, Schema extends z$1.ZodTypeAny, ResultSchema extends z$1.ZodTypeAny, Transport extends HostDaemonCommandTransport, Retryable extends boolean> {
    type: Type;
    schema: Schema;
    resultSchema: ResultSchema;
    transport: Transport;
    retryable: Retryable;
    flushEventsBeforeResult: HostDaemonFlushEventsBeforeResult;
    envLane: HostDaemonCommandEnvironmentLane | null;
}
declare const hostDaemonCommandRegistry: {
    "thread.start": HostDaemonCommandDescriptor<"thread.start", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        projectId: z$1.ZodString;
        providerId: z$1.ZodString;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            reasoningLevel: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            claudeCodePermissionMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            claudeCodeMockCliTraffic: z$1.ZodOptional<z$1.ZodObject<{
                enabled: z$1.ZodBoolean;
                endpoint: z$1.ZodString;
            }, z$1.core.$strict>>;
            workflowsEnabled: z$1.ZodBoolean;
            memoryEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerSubagentsEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"full">;
            permissionEscalation: z$1.ZodNull;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"workspace-write">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"readonly">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>], "permissionMode">>;
        instructions: z$1.ZodString;
        dynamicTools: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            inputSchema: z$1.ZodUnknown;
        }, z$1.core.$strip>>;
        injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"tree">;
            treeHash: z$1.ZodString;
            entryPath: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                builtin: "builtin";
                "data-dir": "data-dir";
            }>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"workspace-path">;
            sourceType: z$1.ZodLiteral<"project">;
            sourceRootPath: z$1.ZodString;
            skillFilePath: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
        disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        instructionMode: z$1.ZodEnum<{
            replace: "replace";
            append: "append";
        }>;
        type: z$1.ZodLiteral<"thread.start">;
        requestId: z$1.ZodString;
        input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>;
        inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>>>;
        threadStoragePath: z$1.ZodOptional<z$1.ZodString>;
        fork: z$1.ZodOptional<z$1.ZodObject<{
            sourceProviderThreadId: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "turn.submit": HostDaemonCommandDescriptor<"turn.submit", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"turn.submit">;
        requestId: z$1.ZodString;
        input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>;
        inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>>>;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            reasoningLevel: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            claudeCodePermissionMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            claudeCodeMockCliTraffic: z$1.ZodOptional<z$1.ZodObject<{
                enabled: z$1.ZodBoolean;
                endpoint: z$1.ZodString;
            }, z$1.core.$strict>>;
            workflowsEnabled: z$1.ZodBoolean;
            memoryEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerSubagentsEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"full">;
            permissionEscalation: z$1.ZodNull;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"workspace-write">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"readonly">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>], "permissionMode">>;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        resumeContext: z$1.ZodObject<{
            workspaceContext: z$1.ZodObject<{
                workspacePath: z$1.ZodString;
                workspaceProvisionType: z$1.ZodEnum<{
                    unmanaged: "unmanaged";
                    "managed-worktree": "managed-worktree";
                    personal: "personal";
                }>;
            }, z$1.core.$strip>;
            instructionMode: z$1.ZodEnum<{
                replace: "replace";
                append: "append";
            }>;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
                displayName: z$1.ZodString;
                command: z$1.ZodString;
                args: z$1.ZodArray<z$1.ZodString>;
                env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
                cwd: z$1.ZodOptional<z$1.ZodString>;
                modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                    listArgs: z$1.ZodArray<z$1.ZodString>;
                    selectFlag: z$1.ZodOptional<z$1.ZodString>;
                    primaryModels: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodTransform<{
                    listArgs: string[];
                    primaryModels: string[];
                    selectFlag?: string | undefined;
                } | undefined, {
                    listArgs: string[];
                    primaryModels: string[];
                    selectFlag?: string | undefined;
                }>>>;
                reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                    flag: z$1.ZodString;
                    supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                    levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }> & z$1.core.$partial, z$1.ZodString>>;
                    defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                }, z$1.core.$strict>>;
                nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                    configId: z$1.ZodString;
                    supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                    levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }> & z$1.core.$partial, z$1.ZodString>>;
                    defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                }, z$1.core.$strict>>;
                permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                    full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>>;
            instructions: z$1.ZodString;
            dynamicTools: z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                inputSchema: z$1.ZodUnknown;
            }, z$1.core.$strip>>;
            injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"tree">;
                treeHash: z$1.ZodString;
                entryPath: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    builtin: "builtin";
                    "data-dir": "data-dir";
                }>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"workspace-path">;
                sourceType: z$1.ZodLiteral<"project">;
                sourceRootPath: z$1.ZodString;
                skillFilePath: z$1.ZodString;
            }, z$1.core.$strict>], "kind">>;
            disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            providerThreadId: z$1.ZodString;
        }, z$1.core.$strict>;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mode: z$1.ZodLiteral<"start">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mode: z$1.ZodLiteral<"auto">;
            expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mode: z$1.ZodLiteral<"steer">;
            expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>], "mode">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        appliedAs: z$1.ZodEnum<{
            steer: "steer";
            "new-turn": "new-turn";
        }>;
    }, z$1.core.$strip>, "settled", false>;
    "thread.stop": HostDaemonCommandDescriptor<"thread.stop", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.stop">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.rename": HostDaemonCommandDescriptor<"thread.rename", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.rename">;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.archive": HostDaemonCommandDescriptor<"thread.archive", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"thread.archive">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.unarchive": HostDaemonCommandDescriptor<"thread.unarchive", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.unarchive">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "interactive.resolve": HostDaemonCommandDescriptor<"interactive.resolve", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"interactive.resolve">;
        interactionId: z$1.ZodString;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        resolution: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_once">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_for_session">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"deny">;
        }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"user_answer">;
            answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
                selected: z$1.ZodArray<z$1.ZodString>;
                freeText: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin_submitted">;
        }, z$1.core.$strip>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "codex.inference.complete": HostDaemonCommandDescriptor<"codex.inference.complete", z$1.ZodObject<{
        type: z$1.ZodLiteral<"codex.inference.complete">;
        model: z$1.ZodString;
        prompt: z$1.ZodString;
        outputSchema: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
        timeoutMs: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        model: z$1.ZodString;
        value: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
    }, z$1.core.$strip>, "settled", false>;
    "codex.voice.transcribe": HostDaemonCommandDescriptor<"codex.voice.transcribe", z$1.ZodObject<{
        type: z$1.ZodLiteral<"codex.voice.transcribe">;
        model: z$1.ZodString;
        audioBase64: z$1.ZodString;
        mimeType: z$1.ZodString;
        filename: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        timeoutMs: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        model: z$1.ZodString;
        text: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "environment.provision": HostDaemonCommandDescriptor<"environment.provision", z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            threadId: z$1.ZodString;
            provisioningId: z$1.ZodString;
        }, z$1.core.$strict>>;
        workspaceProvisionType: z$1.ZodLiteral<"unmanaged">;
        path: z$1.ZodString;
        checkout: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"existing">;
            name: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"new">;
            name: z$1.ZodString;
            baseBranch: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            threadId: z$1.ZodString;
            provisioningId: z$1.ZodString;
        }, z$1.core.$strict>>;
        sourcePath: z$1.ZodString;
        targetPath: z$1.ZodString;
        branchName: z$1.ZodString;
        baseBranch: z$1.ZodNullable<z$1.ZodString>;
        setupTimeoutMs: z$1.ZodNumber;
        workspaceProvisionType: z$1.ZodLiteral<"managed-worktree">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            threadId: z$1.ZodString;
            provisioningId: z$1.ZodString;
        }, z$1.core.$strict>>;
        workspaceProvisionType: z$1.ZodLiteral<"personal">;
        targetPath: z$1.ZodString;
    }, z$1.core.$strict>], "workspaceProvisionType">, z$1.ZodObject<{
        path: z$1.ZodString;
        isGitRepo: z$1.ZodBoolean;
        isWorktree: z$1.ZodBoolean;
        branchName: z$1.ZodNullable<z$1.ZodString>;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        transcript: z$1.ZodArray<z$1.ZodObject<{
            type: z$1.ZodEnum<{
                output: "output";
                step: "step";
            }>;
            key: z$1.ZodString;
            text: z$1.ZodString;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            status: z$1.ZodOptional<z$1.ZodEnum<{
                started: "started";
                completed: "completed";
                failed: "failed";
            }>>;
            metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "settled", false>;
    "project.clone": HostDaemonCommandDescriptor<"project.clone", z$1.ZodObject<{
        type: z$1.ZodLiteral<"project.clone">;
        remoteUrl: z$1.ZodString;
        projectSlug: z$1.ZodString;
        targetPath: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, "settled", false>;
    "environment.provision.cancel": HostDaemonCommandDescriptor<"environment.provision.cancel", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision.cancel">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        aborted: z$1.ZodBoolean;
    }, z$1.core.$strip>, "settled", false>;
    "environment.destroy": HostDaemonCommandDescriptor<"environment.destroy", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"environment.destroy">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "workspace.commit": HostDaemonCommandDescriptor<"workspace.commit", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.commit">;
        message: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commitSha: z$1.ZodString;
        commitSubject: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "workspace.squash_merge": HostDaemonCommandDescriptor<"workspace.squash_merge", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.squash_merge">;
        targetBranch: z$1.ZodString;
        commitMessage: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commitSha: z$1.ZodString;
        commitSubject: z$1.ZodString;
        merged: z$1.ZodBoolean;
    }, z$1.core.$strip>, "settled", false>;
    "workspace.pull_request_action": HostDaemonCommandDescriptor<"workspace.pull_request_action", z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        operation: z$1.ZodLiteral<"ready">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        operation: z$1.ZodLiteral<"draft">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        operation: z$1.ZodLiteral<"merge">;
        method: z$1.ZodEnum<{
            merge: "merge";
            squash: "squash";
            rebase: "rebase";
        }>;
    }, z$1.core.$strict>], "operation">, z$1.ZodObject<{}, z$1.core.$strict>, "settled", false>;
    "host.list_files": HostDaemonCommandDescriptor<"host.list_files", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_files">;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        limit: z$1.ZodNumber;
    }, z$1.core.$strip>, z$1.ZodObject<{
        files: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            name: z$1.ZodString;
        }, z$1.core.$strip>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_paths": HostDaemonCommandDescriptor<"host.list_paths", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_paths">;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        limit: z$1.ZodNumber;
        includeFiles: z$1.ZodBoolean;
        includeDirectories: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        paths: z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z$1.ZodString;
            name: z$1.ZodString;
            score: z$1.ZodNumber;
            positions: z$1.ZodArray<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.mkdir": HostDaemonCommandDescriptor<"host.mkdir", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.mkdir">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        recursive: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.move_path": HostDaemonCommandDescriptor<"host.move_path", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.move_path">;
        sourcePath: z$1.ZodString;
        destinationPath: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.remove_path": HostDaemonCommandDescriptor<"host.remove_path", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.remove_path">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        recursive: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.browse_directory": HostDaemonCommandDescriptor<"host.browse_directory", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.browse_directory">;
        path: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        directory: z$1.ZodString;
        parent: z$1.ZodNullable<z$1.ZodString>;
        entries: z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.paths_exist": HostDaemonCommandDescriptor<"host.paths_exist", z$1.ZodObject<{
        paths: z$1.ZodPipe<z$1.ZodArray<z$1.ZodString>, z$1.ZodTransform<string[], string[]>>;
        type: z$1.ZodLiteral<"host.paths_exist">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        existence: z$1.ZodRecord<z$1.ZodString, z$1.ZodBoolean>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "project.inspect": HostDaemonCommandDescriptor<"project.inspect", z$1.ZodObject<{
        type: z$1.ZodLiteral<"project.inspect">;
        path: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "project.clone_default_path": HostDaemonCommandDescriptor<"project.clone_default_path", z$1.ZodObject<{
        type: z$1.ZodLiteral<"project.clone_default_path">;
        projectSlug: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.pick_folder": HostDaemonCommandDescriptor<"host.pick_folder", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.pick_folder">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, "onlineRpc", false>;
    "host.caffeinate": HostDaemonCommandDescriptor<"host.caffeinate", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.caffeinate">;
        enabled: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        enabled: z$1.ZodBoolean;
        supported: z$1.ZodBoolean;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "connect-tunnel.ensure-identity": HostDaemonCommandDescriptor<"connect-tunnel.ensure-identity", z$1.ZodObject<{
        type: z$1.ZodLiteral<"connect-tunnel.ensure-identity">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        label: z$1.ZodString;
        baseDomain: z$1.ZodString;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.list_commands": HostDaemonCommandDescriptor<"host.list_commands", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_commands">;
        providerId: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commands: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z$1.ZodEnum<{
                project: "project";
                user: "user";
            }>;
            description: z$1.ZodNullable<z$1.ZodString>;
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_branches": HostDaemonCommandDescriptor<"host.list_branches", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_branches">;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        selectedBranch: z$1.ZodOptional<z$1.ZodString>;
        limit: z$1.ZodNumber;
    }, z$1.core.$strip>, z$1.ZodObject<{
        branches: z$1.ZodArray<z$1.ZodString>;
        branchesTruncated: z$1.ZodBoolean;
        checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"branch">;
            branchName: z$1.ZodString;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"detached">;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unborn">;
            branchName: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
            unknown: "unknown";
            equal: "equal";
            "local-behind": "local-behind";
            "local-ahead": "local-ahead";
            diverged: "diverged";
        }>>;
        hasUncommittedChanges: z$1.ZodBoolean;
        operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"none">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"rebase">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"cherry-pick">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"revert">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>], "kind">;
        originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
        remoteBranches: z$1.ZodArray<z$1.ZodString>;
        remoteBranchesTruncated: z$1.ZodBoolean;
        selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            kind: z$1.ZodEnum<{
                local: "local";
                remote: "remote";
                missing: "missing";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.file_metadata": HostDaemonCommandDescriptor<"host.file_metadata", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.file_metadata">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        modifiedAtMs: z$1.ZodNumber;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.read_file": HostDaemonCommandDescriptor<"host.read_file", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.read_file">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        ref: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodNumber;
        modifiedAtMs: z$1.ZodOptional<z$1.ZodNumber>;
        sha256: z$1.ZodString;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.read_file_relative": HostDaemonCommandDescriptor<"host.read_file_relative", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.read_file_relative">;
        rootPath: z$1.ZodString;
        path: z$1.ZodString;
        dotfiles: z$1.ZodEnum<{
            deny: "deny";
            allow: "allow";
        }>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodNumber;
        modifiedAtMs: z$1.ZodOptional<z$1.ZodNumber>;
        sha256: z$1.ZodString;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.write_file": HostDaemonCommandDescriptor<"host.write_file", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.write_file">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        createParents: z$1.ZodBoolean;
        expectedSha256: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
        mode: z$1.ZodOptional<z$1.ZodNumber>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"written">;
        sha256: z$1.ZodString;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"conflict">;
        currentSha256: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", false>;
    "provider.list_models": HostDaemonCommandDescriptor<"provider.list_models", z$1.ZodObject<{
        type: z$1.ZodLiteral<"provider.list_models">;
        providerId: z$1.ZodString;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        models: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            model: z$1.ZodString;
            displayName: z$1.ZodString;
            description: z$1.ZodString;
            supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
                reasoningEffort: z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>;
                description: z$1.ZodString;
            }, z$1.core.$strip>>;
            defaultReasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            isDefault: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
        selectedOnlyModels: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            model: z$1.ZodString;
            displayName: z$1.ZodString;
            description: z$1.ZodString;
            supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
                reasoningEffort: z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>;
                description: z$1.ZodString;
            }, z$1.core.$strip>>;
            defaultReasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            isDefault: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "known_acp_agents.status": HostDaemonCommandDescriptor<"known_acp_agents.status", z$1.ZodObject<{
        type: z$1.ZodLiteral<"known_acp_agents.status">;
        agents: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            executableName: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        agents: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            executableName: z$1.ZodString;
            installed: z$1.ZodBoolean;
            executablePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "provider.usage": HostDaemonCommandDescriptor<"provider.usage", z$1.ZodObject<{
        type: z$1.ZodLiteral<"provider.usage">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        codex: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            status: z$1.ZodLiteral<"ok">;
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                label: z$1.ZodString;
                usedPercent: z$1.ZodNumber;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    usedUsdCents: z$1.ZodNumber;
                    limitUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"error">;
            message: z$1.ZodString;
        }, z$1.core.$strip>], "status">;
        claudeCode: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            status: z$1.ZodLiteral<"ok">;
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                label: z$1.ZodString;
                usedPercent: z$1.ZodNumber;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    usedUsdCents: z$1.ZodNumber;
                    limitUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"error">;
            message: z$1.ZodString;
        }, z$1.core.$strip>], "status">;
        cursor: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            status: z$1.ZodLiteral<"ok">;
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                label: z$1.ZodString;
                usedPercent: z$1.ZodNumber;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    usedUsdCents: z$1.ZodNumber;
                    limitUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"error">;
            message: z$1.ZodString;
        }, z$1.core.$strip>], "status">;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "provider_cli.status": HostDaemonCommandDescriptor<"provider_cli.status", z$1.ZodObject<{
        type: z$1.ZodLiteral<"provider_cli.status">;
    }, z$1.core.$strict>, z$1.ZodRecord<z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>, z$1.ZodObject<{
        displayName: z$1.ZodString;
        executableName: z$1.ZodString;
        executablePath: z$1.ZodNullable<z$1.ZodString>;
        installed: z$1.ZodBoolean;
        installSource: z$1.ZodEnum<{
            notInstalled: "notInstalled";
            npmGlobal: "npmGlobal";
            external: "external";
        }>;
        currentVersion: z$1.ZodNullable<z$1.ZodString>;
        latestVersion: z$1.ZodNullable<z$1.ZodString>;
        minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
        npmPackageName: z$1.ZodNullable<z$1.ZodString>;
        npmGlobalPackageVersion: z$1.ZodNullable<z$1.ZodString>;
        installAction: z$1.ZodNullable<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                install: "install";
                update: "update";
            }>;
            label: z$1.ZodEnum<{
                Install: "Install";
                Update: "Update";
            }>;
            commandKind: z$1.ZodEnum<{
                exec: "exec";
                shell: "shell";
            }>;
            command: z$1.ZodString;
        }, z$1.core.$strip>>;
        needsUpdate: z$1.ZodBoolean;
        versionUnsupported: z$1.ZodBoolean;
    }, z$1.core.$strip>>, "onlineRpc", true>;
    "provider_cli.install": HostDaemonCommandDescriptor<"provider_cli.install", z$1.ZodObject<{
        provider: z$1.ZodEnum<{
            codex: "codex";
            claudeCode: "claudeCode";
            cursor: "cursor";
        }>;
        actionKind: z$1.ZodEnum<{
            install: "install";
            update: "update";
        }>;
        type: z$1.ZodLiteral<"provider_cli.install">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        events: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"started">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            command: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"output">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            stream: z$1.ZodEnum<{
                stdout: "stdout";
                stderr: "stderr";
            }>;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"completed">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            exitCode: z$1.ZodNullable<z$1.ZodNumber>;
            signal: z$1.ZodNullable<z$1.ZodString>;
            success: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"error">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            message: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "workspace.status": HostDaemonCommandDescriptor<"workspace.status", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.status">;
        mergeBaseBranch: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        workspaceStatus: z$1.ZodObject<{
            workingTree: z$1.ZodObject<{
                insertions: z$1.ZodNumber;
                deletions: z$1.ZodNumber;
                files: z$1.ZodArray<z$1.ZodObject<{
                    path: z$1.ZodString;
                    status: z$1.ZodEnum<{
                        M: "M";
                        A: "A";
                        D: "D";
                        R: "R";
                        C: "C";
                        U: "U";
                        "??": "??";
                        "?": "?";
                    }>;
                    insertions: z$1.ZodNullable<z$1.ZodNumber>;
                    deletions: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>>;
                hasUncommittedChanges: z$1.ZodBoolean;
                state: z$1.ZodEnum<{
                    clean: "clean";
                    untracked: "untracked";
                    dirty_uncommitted: "dirty_uncommitted";
                    committed_unmerged: "committed_unmerged";
                    dirty_and_committed_unmerged: "dirty_and_committed_unmerged";
                }>;
            }, z$1.core.$strip>;
            checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"branch">;
                branchName: z$1.ZodString;
                headSha: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"detached">;
                headSha: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"unborn">;
                branchName: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"unknown">;
                reason: z$1.ZodString;
            }, z$1.core.$strip>], "kind">;
            branch: z$1.ZodObject<{
                currentBranch: z$1.ZodNullable<z$1.ZodString>;
                defaultBranch: z$1.ZodString;
            }, z$1.core.$strip>;
            mergeBase: z$1.ZodNullable<z$1.ZodObject<{
                insertions: z$1.ZodNumber;
                deletions: z$1.ZodNumber;
                files: z$1.ZodArray<z$1.ZodObject<{
                    path: z$1.ZodString;
                    status: z$1.ZodEnum<{
                        M: "M";
                        A: "A";
                        D: "D";
                        R: "R";
                        C: "C";
                        U: "U";
                        "??": "??";
                        "?": "?";
                    }>;
                    insertions: z$1.ZodNullable<z$1.ZodNumber>;
                    deletions: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>>;
                mergeBaseBranch: z$1.ZodString;
                baseRef: z$1.ZodNullable<z$1.ZodString>;
                aheadCount: z$1.ZodNumber;
                behindCount: z$1.ZodNumber;
                hasCommittedUnmergedChanges: z$1.ZodBoolean;
                commits: z$1.ZodArray<z$1.ZodObject<{
                    sha: z$1.ZodString;
                    shortSha: z$1.ZodString;
                    subject: z$1.ZodString;
                    authorName: z$1.ZodString;
                    authoredAt: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                unknown: "unknown";
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diff": HostDaemonCommandDescriptor<"workspace.diff", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.diff">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"branch_committed">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"all">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"commit">;
            sha: z$1.ZodString;
        }, z$1.core.$strip>], "type">;
        maxDiffBytes: z$1.ZodNumber;
        maxFileListBytes: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        diff: z$1.ZodObject<{
            diff: z$1.ZodString;
            truncated: z$1.ZodBoolean;
            shortstat: z$1.ZodString;
            files: z$1.ZodString;
            mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                unknown: "unknown";
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diffFiles": HostDaemonCommandDescriptor<"workspace.diffFiles", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.diffFiles">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"branch_committed">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"all">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"commit">;
            sha: z$1.ZodString;
        }, z$1.core.$strip>], "type">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        files: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            previousPath: z$1.ZodNullable<z$1.ZodString>;
            statusLetter: z$1.ZodEnum<{
                M: "M";
                A: "A";
                D: "D";
                R: "R";
                C: "C";
                T: "T";
            }>;
            additions: z$1.ZodNumber;
            deletions: z$1.ZodNumber;
            binary: z$1.ZodBoolean;
            origin: z$1.ZodEnum<{
                untracked: "untracked";
                tracked: "tracked";
            }>;
        }, z$1.core.$strip>>;
        shortstat: z$1.ZodString;
        mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                unknown: "unknown";
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diffPatch": HostDaemonCommandDescriptor<"workspace.diffPatch", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.diffPatch">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"branch_committed">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"all">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"commit">;
            sha: z$1.ZodString;
        }, z$1.core.$strip>], "type">;
        paths: z$1.ZodArray<z$1.ZodString>;
        maxBytesPerFile: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        patches: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            patch: z$1.ZodString;
            truncated: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                unknown: "unknown";
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.pull_request": HostDaemonCommandDescriptor<"workspace.pull_request", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        pullRequest: z$1.ZodObject<{
            number: z$1.ZodNumber;
            title: z$1.ZodString;
            state: z$1.ZodEnum<{
                OPEN: "OPEN";
                CLOSED: "CLOSED";
                MERGED: "MERGED";
            }>;
            url: z$1.ZodString;
            isDraft: z$1.ZodBoolean;
            baseRefName: z$1.ZodString;
            headRefName: z$1.ZodString;
            updatedAt: z$1.ZodString;
            checks: z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                status: z$1.ZodEnum<{
                    unknown: "unknown";
                    completed: "completed";
                    queued: "queued";
                    in_progress: "in_progress";
                }>;
                conclusion: z$1.ZodNullable<z$1.ZodEnum<{
                    unknown: "unknown";
                    success: "success";
                    failure: "failure";
                    cancelled: "cancelled";
                    skipped: "skipped";
                    neutral: "neutral";
                    timed_out: "timed_out";
                    action_required: "action_required";
                    startup_failure: "startup_failure";
                    stale: "stale";
                }>>;
                url: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strict>>;
            reviewDecision: z$1.ZodNullable<z$1.ZodEnum<{
                APPROVED: "APPROVED";
                CHANGES_REQUESTED: "CHANGES_REQUESTED";
                REVIEW_REQUIRED: "REVIEW_REQUIRED";
            }>>;
            reviewRequestCount: z$1.ZodNumber;
            mergeStateStatus: z$1.ZodNullable<z$1.ZodEnum<{
                BEHIND: "BEHIND";
                BLOCKED: "BLOCKED";
                CLEAN: "CLEAN";
                DIRTY: "DIRTY";
                DRAFT: "DRAFT";
                HAS_HOOKS: "HAS_HOOKS";
                UNKNOWN: "UNKNOWN";
                UNSTABLE: "UNSTABLE";
            }>>;
            mergeable: z$1.ZodNullable<z$1.ZodEnum<{
                UNKNOWN: "UNKNOWN";
                CONFLICTING: "CONFLICTING";
                MERGEABLE: "MERGEABLE";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"absent">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        message: z$1.ZodString;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
};
type HostDaemonCommandRegistry = typeof hostDaemonCommandRegistry;
type AnyHostDaemonCommandDescriptor = HostDaemonCommandRegistry[keyof HostDaemonCommandRegistry];
type HostDaemonCommandDescriptorForTransport<Transport extends HostDaemonCommandTransport> = Extract<AnyHostDaemonCommandDescriptor, {
    transport: Transport;
}>;
type HostDaemonResultSchemaMapForTransport<Transport extends HostDaemonCommandTransport> = {
    [Descriptor in HostDaemonCommandDescriptorForTransport<Transport> as Descriptor["type"]]: Descriptor["resultSchema"];
};
type HostDaemonOnlineRpcResultSchemaMap = HostDaemonResultSchemaMapForTransport<"onlineRpc">;
type HostDaemonOnlineRpcResultByType = {
    [K in keyof HostDaemonOnlineRpcResultSchemaMap]: z$1.infer<HostDaemonOnlineRpcResultSchemaMap[K]>;
};

declare const pickFolderResponseSchema: z$1.ZodObject<{
    path: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type PickFolderResponse = z$1.infer<typeof pickFolderResponseSchema>;
declare const pathsExistRequestSchema: z$1.ZodObject<{
    paths: z$1.ZodPipe<z$1.ZodArray<z$1.ZodString>, z$1.ZodTransform<string[], string[]>>;
}, z$1.core.$strip>;
type PathsExistRequest = z$1.infer<typeof pathsExistRequestSchema>;
declare const pathsExistResponseSchema: z$1.ZodObject<{
    existence: z$1.ZodRecord<z$1.ZodString, z$1.ZodBoolean>;
}, z$1.core.$strip>;
type PathsExistResponse = z$1.infer<typeof pathsExistResponseSchema>;
declare const providerCliStatusResponseSchema: z$1.ZodRecord<z$1.ZodEnum<{
    codex: "codex";
    claudeCode: "claudeCode";
    cursor: "cursor";
}>, z$1.ZodObject<{
    displayName: z$1.ZodString;
    executableName: z$1.ZodString;
    executablePath: z$1.ZodNullable<z$1.ZodString>;
    installed: z$1.ZodBoolean;
    installSource: z$1.ZodEnum<{
        notInstalled: "notInstalled";
        npmGlobal: "npmGlobal";
        external: "external";
    }>;
    currentVersion: z$1.ZodNullable<z$1.ZodString>;
    latestVersion: z$1.ZodNullable<z$1.ZodString>;
    minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
    npmPackageName: z$1.ZodNullable<z$1.ZodString>;
    npmGlobalPackageVersion: z$1.ZodNullable<z$1.ZodString>;
    installAction: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            install: "install";
            update: "update";
        }>;
        label: z$1.ZodEnum<{
            Install: "Install";
            Update: "Update";
        }>;
        commandKind: z$1.ZodEnum<{
            exec: "exec";
            shell: "shell";
        }>;
        command: z$1.ZodString;
    }, z$1.core.$strip>>;
    needsUpdate: z$1.ZodBoolean;
    versionUnsupported: z$1.ZodBoolean;
}, z$1.core.$strip>>;
type ProviderCliStatusResponse = z$1.infer<typeof providerCliStatusResponseSchema>;
declare const providerCliInstallRequestSchema: z$1.ZodObject<{
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    actionKind: z$1.ZodEnum<{
        install: "install";
        update: "update";
    }>;
}, z$1.core.$strip>;
type ProviderCliInstallRequest = z$1.infer<typeof providerCliInstallRequestSchema>;
declare const providerCliInstallEventSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"started">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    command: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"output">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    stream: z$1.ZodEnum<{
        stdout: "stdout";
        stderr: "stderr";
    }>;
    text: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"completed">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    signal: z$1.ZodNullable<z$1.ZodString>;
    success: z$1.ZodBoolean;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"error">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>], "type">;
type ProviderCliInstallEvent = z$1.infer<typeof providerCliInstallEventSchema>;

interface CreateFilePreviewResponse {
    baseUrl: string;
    expiresAtMs: number;
}
type HostFileReadResponse = HostDaemonOnlineRpcResultByType["host.read_file"];
type HostFileWriteResponse = HostDaemonOnlineRpcResultByType["host.write_file"];
type HostFileListResponse = HostDaemonOnlineRpcResultByType["host.list_files"];
type HostPathListResponse = HostDaemonOnlineRpcResultByType["host.list_paths"];
type HostMkdirResponse = HostDaemonOnlineRpcResultByType["host.mkdir"];
type HostMovePathResponse = HostDaemonOnlineRpcResultByType["host.move_path"];
type HostRemovePathResponse = HostDaemonOnlineRpcResultByType["host.remove_path"];

/**
 * Query for `GET /hosts/:id/directory`, the interactive path browser's
 * single-level directory read. `path` is an absolute directory on the host;
 * omitting it lists the host's home directory (the daemon resolves it, since a
 * remote caller cannot know the host's home).
 */
declare const hostDirectoryQuerySchema: z$1.ZodObject<{
    path: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type HostDirectoryQuery = z$1.infer<typeof hostDirectoryQuerySchema>;
declare const hostDirectoryListingSchema: z$1.ZodObject<{
    directory: z$1.ZodString;
    parent: z$1.ZodNullable<z$1.ZodString>;
    entries: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        name: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type HostDirectoryListing = z$1.infer<typeof hostDirectoryListingSchema>;
/** Project name is sent so the daemon can derive its host-local checkout path. */
declare const hostCloneDefaultPathQuerySchema: z$1.ZodObject<{
    projectId: z$1.ZodString;
}, z$1.core.$strip>;
type HostCloneDefaultPathQuery = z$1.infer<typeof hostCloneDefaultPathQuerySchema>;
declare const hostCloneDefaultPathResponseSchema: z$1.ZodObject<{
    path: z$1.ZodString;
}, z$1.core.$strict>;
type HostCloneDefaultPathResponse = z$1.infer<typeof hostCloneDefaultPathResponseSchema>;
declare const createHostJoinCodeResponseSchema: z$1.ZodObject<{
    joinCode: z$1.ZodString;
    hostId: z$1.ZodString;
    expiresAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type CreateHostJoinCodeResponse = z$1.infer<typeof createHostJoinCodeResponseSchema>;
declare const updateHostRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateHostRequest = z$1.infer<typeof updateHostRequestSchema>;
type HostPathsExistRequest = PathsExistRequest;
type HostPathsExistResponse = PathsExistResponse;
declare const hostPickFolderRequestSchema: z$1.ZodObject<{
    clientHostId: z$1.ZodString;
}, z$1.core.$strict>;
type HostPickFolderRequest = z$1.infer<typeof hostPickFolderRequestSchema>;
type HostPickFolderResponse = PickFolderResponse;
type HostProviderCliStatusResponse = ProviderCliStatusResponse;
type HostProviderCliInstallRequest = ProviderCliInstallRequest;
type HostProviderCliInstallEvent = ProviderCliInstallEvent;

declare const pluginUpdateCheckEntrySchema: z$1.ZodObject<{
    id: z$1.ZodString;
    outcome: z$1.ZodEnum<{
        unavailable: "unavailable";
        incompatible: "incompatible";
        current: "current";
        "update-available": "update-available";
        pinned: "pinned";
    }>;
    devMode: z$1.ZodOptional<z$1.ZodLiteral<true>>;
    installed: z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>;
    candidate: z$1.ZodOptional<z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>>;
    blocked: z$1.ZodOptional<z$1.ZodObject<{
        version: z$1.ZodString;
        reasons: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    detail: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginUpdateCheckEntry = z$1.infer<typeof pluginUpdateCheckEntrySchema>;
declare const pluginApplyUpdateResultSchema: z$1.ZodObject<{
    applied: z$1.ZodBoolean;
    from: z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>;
    to: z$1.ZodOptional<z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>>;
    outcome: z$1.ZodEnum<{
        current: "current";
        updated: "updated";
        "rolled-back": "rolled-back";
    }>;
    detail: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginApplyUpdateResult$1 = z$1.infer<typeof pluginApplyUpdateResultSchema>;
declare const pluginSourceDetailSchema: z$1.ZodObject<{
    requested: z$1.ZodString;
    resolved: z$1.ZodString;
    integrity: z$1.ZodOptional<z$1.ZodString>;
    registry: z$1.ZodOptional<z$1.ZodString>;
    engines: z$1.ZodObject<{
        bb: z$1.ZodOptional<z$1.ZodString>;
        bbPluginSdk: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
    installedAt: z$1.ZodOptional<z$1.ZodNumber>;
    history: z$1.ZodArray<z$1.ZodObject<{
        version: z$1.ZodString;
        activatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginSourceDetail = z$1.infer<typeof pluginSourceDetailSchema>;
declare const installedPluginSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    source: z$1.ZodString;
    rootDir: z$1.ZodString;
    version: z$1.ZodString;
    provenance: z$1.ZodEnum<{
        builtin: "builtin";
        direct: "direct";
        catalog: "catalog";
    }>;
    isOrphanedBuiltin: z$1.ZodBoolean;
    catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
    sourceDisplay: z$1.ZodString;
    updateState: z$1.ZodObject<{
        outcome: z$1.ZodOptional<z$1.ZodEnum<{
            unavailable: "unavailable";
            incompatible: "incompatible";
            current: "current";
            "update-available": "update-available";
            pinned: "pinned";
        }>>;
        availableVersion: z$1.ZodOptional<z$1.ZodString>;
        blockedVersion: z$1.ZodOptional<z$1.ZodString>;
        blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
        lastFailure: z$1.ZodOptional<z$1.ZodObject<{
            version: z$1.ZodString;
            at: z$1.ZodNumber;
            detail: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    enabled: z$1.ZodBoolean;
    description: z$1.ZodNullable<z$1.ZodString>;
    name: z$1.ZodNullable<z$1.ZodString>;
    icon: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        running: "running";
        missing: "missing";
        incompatible: "incompatible";
        disabled: "disabled";
        degraded: "degraded";
        "needs-configuration": "needs-configuration";
    }>;
    statusDetail: z$1.ZodNullable<z$1.ZodString>;
    handlerStats: z$1.ZodObject<{
        count: z$1.ZodNumber;
        totalMs: z$1.ZodNumber;
        maxMs: z$1.ZodNumber;
        errorCount: z$1.ZodNumber;
    }, z$1.core.$strip>;
    services: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        state: z$1.ZodEnum<{
            running: "running";
            stopped: "stopped";
            backoff: "backoff";
        }>;
    }, z$1.core.$strip>>;
    schedules: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        cron: z$1.ZodString;
        nextRunAt: z$1.ZodNumber;
        lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
            error: "error";
            running: "running";
            ok: "ok";
        }>>;
        lastError: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    cliCommand: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        summary: z$1.ZodString;
    }, z$1.core.$strip>>;
    hasSettings: z$1.ZodBoolean;
    app: z$1.ZodObject<{
        hasApp: z$1.ZodBoolean;
        bundle: z$1.ZodNullable<z$1.ZodObject<{
            jsUrl: z$1.ZodString;
            cssUrl: z$1.ZodNullable<z$1.ZodString>;
            hash: z$1.ZodString;
            sdkMajor: z$1.ZodNumber;
            sdkVersion: z$1.ZodString;
            compatible: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type InstalledPlugin = z$1.infer<typeof installedPluginSchema>;
declare const pluginListResponseSchema: z$1.ZodObject<{
    enabled: z$1.ZodBoolean;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        source: z$1.ZodString;
        rootDir: z$1.ZodString;
        version: z$1.ZodString;
        provenance: z$1.ZodEnum<{
            builtin: "builtin";
            direct: "direct";
            catalog: "catalog";
        }>;
        isOrphanedBuiltin: z$1.ZodBoolean;
        catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
        sourceDisplay: z$1.ZodString;
        updateState: z$1.ZodObject<{
            outcome: z$1.ZodOptional<z$1.ZodEnum<{
                unavailable: "unavailable";
                incompatible: "incompatible";
                current: "current";
                "update-available": "update-available";
                pinned: "pinned";
            }>>;
            availableVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastFailure: z$1.ZodOptional<z$1.ZodObject<{
                version: z$1.ZodString;
                at: z$1.ZodNumber;
                detail: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        enabled: z$1.ZodBoolean;
        description: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        icon: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            running: "running";
            missing: "missing";
            incompatible: "incompatible";
            disabled: "disabled";
            degraded: "degraded";
            "needs-configuration": "needs-configuration";
        }>;
        statusDetail: z$1.ZodNullable<z$1.ZodString>;
        handlerStats: z$1.ZodObject<{
            count: z$1.ZodNumber;
            totalMs: z$1.ZodNumber;
            maxMs: z$1.ZodNumber;
            errorCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        services: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            state: z$1.ZodEnum<{
                running: "running";
                stopped: "stopped";
                backoff: "backoff";
            }>;
        }, z$1.core.$strip>>;
        schedules: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            cron: z$1.ZodString;
            nextRunAt: z$1.ZodNumber;
            lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
            lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
                error: "error";
                running: "running";
                ok: "ok";
            }>>;
            lastError: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
        cliCommand: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            summary: z$1.ZodString;
        }, z$1.core.$strip>>;
        hasSettings: z$1.ZodBoolean;
        app: z$1.ZodObject<{
            hasApp: z$1.ZodBoolean;
            bundle: z$1.ZodNullable<z$1.ZodObject<{
                jsUrl: z$1.ZodString;
                cssUrl: z$1.ZodNullable<z$1.ZodString>;
                hash: z$1.ZodString;
                sdkMajor: z$1.ZodNumber;
                sdkVersion: z$1.ZodString;
                compatible: z$1.ZodBoolean;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginListResponse = z$1.infer<typeof pluginListResponseSchema>;
declare const pluginReloadResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        source: z$1.ZodString;
        rootDir: z$1.ZodString;
        version: z$1.ZodString;
        provenance: z$1.ZodEnum<{
            builtin: "builtin";
            direct: "direct";
            catalog: "catalog";
        }>;
        isOrphanedBuiltin: z$1.ZodBoolean;
        catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
        sourceDisplay: z$1.ZodString;
        updateState: z$1.ZodObject<{
            outcome: z$1.ZodOptional<z$1.ZodEnum<{
                unavailable: "unavailable";
                incompatible: "incompatible";
                current: "current";
                "update-available": "update-available";
                pinned: "pinned";
            }>>;
            availableVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastFailure: z$1.ZodOptional<z$1.ZodObject<{
                version: z$1.ZodString;
                at: z$1.ZodNumber;
                detail: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        enabled: z$1.ZodBoolean;
        description: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        icon: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            running: "running";
            missing: "missing";
            incompatible: "incompatible";
            disabled: "disabled";
            degraded: "degraded";
            "needs-configuration": "needs-configuration";
        }>;
        statusDetail: z$1.ZodNullable<z$1.ZodString>;
        handlerStats: z$1.ZodObject<{
            count: z$1.ZodNumber;
            totalMs: z$1.ZodNumber;
            maxMs: z$1.ZodNumber;
            errorCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        services: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            state: z$1.ZodEnum<{
                running: "running";
                stopped: "stopped";
                backoff: "backoff";
            }>;
        }, z$1.core.$strip>>;
        schedules: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            cron: z$1.ZodString;
            nextRunAt: z$1.ZodNumber;
            lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
            lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
                error: "error";
                running: "running";
                ok: "ok";
            }>>;
            lastError: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
        cliCommand: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            summary: z$1.ZodString;
        }, z$1.core.$strip>>;
        hasSettings: z$1.ZodBoolean;
        app: z$1.ZodObject<{
            hasApp: z$1.ZodBoolean;
            bundle: z$1.ZodNullable<z$1.ZodObject<{
                jsUrl: z$1.ZodString;
                cssUrl: z$1.ZodNullable<z$1.ZodString>;
                hash: z$1.ZodString;
                sdkMajor: z$1.ZodNumber;
                sdkVersion: z$1.ZodString;
                compatible: z$1.ZodBoolean;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginReloadResponse = z$1.infer<typeof pluginReloadResponseSchema>;
declare const pluginRemoveResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type PluginRemoveResponse = z$1.infer<typeof pluginRemoveResponseSchema>;
declare const pluginSettingsResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    schema: z$1.ZodRecord<z$1.ZodString, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"string">;
        secret: z$1.ZodOptional<z$1.ZodLiteral<true>>;
        default: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"boolean">;
        default: z$1.ZodOptional<z$1.ZodBoolean>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"select">;
        options: z$1.ZodArray<z$1.ZodString>;
        default: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"project">;
        default: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>], "type">>;
    values: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue, unknown, z$1.core.$ZodTypeInternals<JsonValue, unknown>>>;
}, z$1.core.$strip>;
type PluginSettingsResponse = z$1.infer<typeof pluginSettingsResponseSchema>;
declare const pluginTokenResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    token: z$1.ZodString;
}, z$1.core.$strip>;
type PluginTokenResponse = z$1.infer<typeof pluginTokenResponseSchema>;
declare const pluginCatalogStatusSchema: z$1.ZodObject<{
    pluginCount: z$1.ZodNumber;
}, z$1.core.$strip>;
type PluginCatalogStatus = z$1.infer<typeof pluginCatalogStatusSchema>;
declare const pluginCatalogSearchResultSchema: z$1.ZodObject<{
    entryId: z$1.ZodString;
    displayName: z$1.ZodString;
    description: z$1.ZodString;
    icon: z$1.ZodNullable<z$1.ZodString>;
    category: z$1.ZodString;
    source: z$1.ZodString;
    installed: z$1.ZodBoolean;
    compatible: z$1.ZodBoolean;
    incompatibleReason: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginCatalogSearchResult$1 = z$1.infer<typeof pluginCatalogSearchResultSchema>;

declare const systemExecutionOptionsResponseSchema: z$1.ZodObject<{
    providers: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        displayName: z$1.ZodString;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        capabilities: z$1.ZodObject<{
            supportsArchive: z$1.ZodBoolean;
            supportsRename: z$1.ZodBoolean;
            supportsServiceTier: z$1.ZodBoolean;
            supportsUserQuestion: z$1.ZodBoolean;
            supportsFork: z$1.ZodBoolean;
            supportedPermissionModes: z$1.ZodArray<z$1.ZodEnum<{
                readonly: "readonly";
                full: "full";
                "workspace-write": "workspace-write";
            }>>;
        }, z$1.core.$strip>;
        composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"skills">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plan">;
            command: z$1.ZodObject<{
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                trailingText: z$1.ZodString;
            }, z$1.core.$strip>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"goal">;
            command: z$1.ZodObject<{
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                trailingText: z$1.ZodString;
            }, z$1.core.$strip>;
        }, z$1.core.$strip>], "kind">>;
        available: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    models: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        model: z$1.ZodString;
        displayName: z$1.ZodString;
        description: z$1.ZodString;
        supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
            reasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            description: z$1.ZodString;
        }, z$1.core.$strip>>;
        defaultReasoningEffort: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        isDefault: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    selectedOnlyModels: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        model: z$1.ZodString;
        displayName: z$1.ZodString;
        description: z$1.ZodString;
        supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
            reasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            description: z$1.ZodString;
        }, z$1.core.$strip>>;
        defaultReasoningEffort: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        isDefault: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    modelLoadError: z$1.ZodNullable<z$1.ZodObject<{
        providerId: z$1.ZodString;
        code: z$1.ZodEnum<{
            failed: "failed";
            missing_executable: "missing_executable";
            auth_required: "auth_required";
            timeout: "timeout";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SystemExecutionOptionsResponse = z$1.infer<typeof systemExecutionOptionsResponseSchema>;
declare const systemExecutionOptionsQuerySchema: z$1.ZodObject<{
    providerId: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemExecutionOptionsQuery = z$1.infer<typeof systemExecutionOptionsQuerySchema>;
/** Omission preserves the existing behavior of reading the primary machine. */
declare const systemUsageLimitsQuerySchema: z$1.ZodObject<{
    hostId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemUsageLimitsQuery = z$1.infer<typeof systemUsageLimitsQuerySchema>;
declare const systemVoiceTranscriptionResponseSchema: z$1.ZodObject<{
    text: z$1.ZodString;
}, z$1.core.$strip>;
type SystemVoiceTranscriptionResponse = z$1.infer<typeof systemVoiceTranscriptionResponseSchema>;
declare const systemConfigResponseSchema: z$1.ZodObject<{
    generalSettings: z$1.ZodObject<{
        caffeinate: z$1.ZodBoolean;
        showKeyboardHints: z$1.ZodBoolean;
        showUnhandledProviderEvents: z$1.ZodBoolean;
        codexMemoryEnabled: z$1.ZodBoolean;
        claudeCodeMemoryEnabled: z$1.ZodBoolean;
        codexSubagentsDisabled: z$1.ZodBoolean;
        claudeCodeSubagentsDisabled: z$1.ZodBoolean;
        claudeCodeWorkflowsDisabled: z$1.ZodBoolean;
    }, z$1.core.$strict>;
    keybindings: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "thread.new": "thread.new";
            "thread.search": "thread.search";
            "thread.previous": "thread.previous";
            "thread.next": "thread.next";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "pane.focus.previous": "pane.focus.previous";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "pane.close": "pane.close";
            "window.new": "window.new";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "panel.newTab": "panel.newTab";
            "panel.close": "panel.close";
            "panel.toggle": "panel.toggle";
            "file.quickOpen": "file.quickOpen";
            "diff.toggle": "diff.toggle";
            "terminal.open": "terminal.open";
            "composer.focus": "composer.focus";
            "modelPicker.toggle": "modelPicker.toggle";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "workspace.openPreferred": "workspace.openPreferred";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
        }>;
        desktopOnly: z$1.ZodBoolean;
        shortcut: z$1.ZodObject<{
            key: z$1.ZodString;
            mod: z$1.ZodBoolean;
            meta: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            alt: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>;
        when: z$1.ZodObject<{
            all: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
            }>>;
            none: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>>;
    defaultKeybindings: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "thread.new": "thread.new";
            "thread.search": "thread.search";
            "thread.previous": "thread.previous";
            "thread.next": "thread.next";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "pane.focus.previous": "pane.focus.previous";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "pane.close": "pane.close";
            "window.new": "window.new";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "panel.newTab": "panel.newTab";
            "panel.close": "panel.close";
            "panel.toggle": "panel.toggle";
            "file.quickOpen": "file.quickOpen";
            "diff.toggle": "diff.toggle";
            "terminal.open": "terminal.open";
            "composer.focus": "composer.focus";
            "modelPicker.toggle": "modelPicker.toggle";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "workspace.openPreferred": "workspace.openPreferred";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
        }>;
        desktopOnly: z$1.ZodBoolean;
        shortcut: z$1.ZodObject<{
            key: z$1.ZodString;
            mod: z$1.ZodBoolean;
            meta: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            alt: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>;
        when: z$1.ZodObject<{
            all: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
            }>>;
            none: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>>;
    keybindingOverrides: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "thread.new": "thread.new";
            "thread.search": "thread.search";
            "thread.previous": "thread.previous";
            "thread.next": "thread.next";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "pane.focus.previous": "pane.focus.previous";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "pane.close": "pane.close";
            "window.new": "window.new";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "panel.newTab": "panel.newTab";
            "panel.close": "panel.close";
            "panel.toggle": "panel.toggle";
            "file.quickOpen": "file.quickOpen";
            "diff.toggle": "diff.toggle";
            "terminal.open": "terminal.open";
            "composer.focus": "composer.focus";
            "modelPicker.toggle": "modelPicker.toggle";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "workspace.openPreferred": "workspace.openPreferred";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
        }>;
        shortcut: z$1.ZodNullable<z$1.ZodObject<{
            key: z$1.ZodString;
            mod: z$1.ZodBoolean;
            meta: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            alt: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    experiments: z$1.ZodObject<{
        claudeCodeMockCliTraffic: z$1.ZodBoolean;
        plugins: z$1.ZodBoolean;
    }, z$1.core.$strip>;
    appearance: z$1.ZodObject<{
        themeId: z$1.ZodString;
        customCss: z$1.ZodNullable<z$1.ZodString>;
        faviconColor: z$1.ZodEnum<{
            default: "default";
            red: "red";
            orange: "orange";
            yellow: "yellow";
            green: "green";
            teal: "teal";
            blue: "blue";
            purple: "purple";
            pink: "pink";
        }>;
    }, z$1.core.$strip>;
    customThemes: z$1.ZodArray<z$1.ZodString>;
    pluginThemes: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        pluginId: z$1.ZodString;
        name: z$1.ZodString;
        description: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    featureFlags: z$1.ZodObject<{
        placeholder: z$1.ZodBoolean;
    }, z$1.core.$strip>;
    hostDaemonPort: z$1.ZodNullable<z$1.ZodNumber>;
    primaryHostId: z$1.ZodNullable<z$1.ZodString>;
    primaryHostPlatform: z$1.ZodNullable<z$1.ZodEnum<{
        unknown: "unknown";
        darwin: "darwin";
        linux: "linux";
        wsl: "wsl";
    }>>;
    voiceTranscriptionEnabled: z$1.ZodBoolean;
    dataDir: z$1.ZodString;
}, z$1.core.$strip>;
type SystemConfigResponse = z$1.infer<typeof systemConfigResponseSchema>;
declare const systemAttentionResponseSchema: z$1.ZodObject<{
    hasAttention: z$1.ZodBoolean;
}, z$1.core.$strip>;
type SystemAttentionResponse = z$1.infer<typeof systemAttentionResponseSchema>;
/**
 * Theme catalog: the on-disk custom-theme directory plus the discovered custom
 * themes and the active palette. Drives `bb theme list` / `bb theme dir`.
 */
declare const themeCatalogResponseSchema: z$1.ZodObject<{
    dir: z$1.ZodString;
    custom: z$1.ZodArray<z$1.ZodString>;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        pluginId: z$1.ZodString;
        name: z$1.ZodString;
        description: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    active: z$1.ZodObject<{
        themeId: z$1.ZodString;
        customCss: z$1.ZodNullable<z$1.ZodString>;
        faviconColor: z$1.ZodEnum<{
            default: "default";
            red: "red";
            orange: "orange";
            yellow: "yellow";
            green: "green";
            teal: "teal";
            blue: "blue";
            purple: "purple";
            pink: "pink";
        }>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>;
type ThemeCatalogResponse = z$1.infer<typeof themeCatalogResponseSchema>;
declare const systemVersionResponseSchema: z$1.ZodObject<{
    currentVersion: z$1.ZodString;
    latestVersion: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodLiteral<"npm">;
    updateAvailable: z$1.ZodBoolean;
    isDevelopment: z$1.ZodBoolean;
    upgradeCommand: z$1.ZodString;
}, z$1.core.$strip>;
type SystemVersionResponse = z$1.infer<typeof systemVersionResponseSchema>;
declare const systemConfigReloadResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type SystemConfigReloadResponse = z$1.infer<typeof systemConfigReloadResponseSchema>;

declare const terminalSessionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodNullable<z$1.ZodString>;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    hostId: z$1.ZodString;
    title: z$1.ZodString;
    initialCwd: z$1.ZodString;
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        starting: "starting";
        disconnected: "disconnected";
        running: "running";
        exited: "exited";
    }>;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    closeReason: z$1.ZodNullable<z$1.ZodEnum<{
        user: "user";
        "thread-deleted": "thread-deleted";
        "process-exit": "process-exit";
        "daemon-disconnect": "daemon-disconnect";
        "environment-destroyed": "environment-destroyed";
        "thread-archived": "thread-archived";
        "open-timeout": "open-timeout";
    }>>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    lastUserInputAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TerminalSession = z$1.infer<typeof terminalSessionSchema>;
declare const terminalListResponseSchema: z$1.ZodObject<{
    sessions: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        hostId: z$1.ZodString;
        title: z$1.ZodString;
        initialCwd: z$1.ZodString;
        cols: z$1.ZodNumber;
        rows: z$1.ZodNumber;
        status: z$1.ZodEnum<{
            starting: "starting";
            disconnected: "disconnected";
            running: "running";
            exited: "exited";
        }>;
        exitCode: z$1.ZodNullable<z$1.ZodNumber>;
        closeReason: z$1.ZodNullable<z$1.ZodEnum<{
            user: "user";
            "thread-deleted": "thread-deleted";
            "process-exit": "process-exit";
            "daemon-disconnect": "daemon-disconnect";
            "environment-destroyed": "environment-destroyed";
            "thread-archived": "thread-archived";
            "open-timeout": "open-timeout";
        }>>;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        lastUserInputAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type TerminalListResponse = z$1.infer<typeof terminalListResponseSchema>;
declare const createTerminalRequestSchema: z$1.ZodObject<{
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
    start: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mode: z$1.ZodLiteral<"shell">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        mode: z$1.ZodLiteral<"command">;
        command: z$1.ZodString;
    }, z$1.core.$strict>], "mode">>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"environment">;
        environmentId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"host_path">;
        hostId: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>], "kind">;
    title: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type CreateTerminalRequest = z$1.infer<typeof createTerminalRequestSchema>;
declare const updateTerminalRequestSchema: z$1.ZodObject<{
    title: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateTerminalRequest = z$1.infer<typeof updateTerminalRequestSchema>;
declare const terminalInputRequestSchema: z$1.ZodObject<{
    dataBase64: z$1.ZodString;
}, z$1.core.$strict>;
type TerminalInputRequest = z$1.infer<typeof terminalInputRequestSchema>;
declare const terminalResizeRequestSchema: z$1.ZodObject<{
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
}, z$1.core.$strict>;
type TerminalResizeRequest = z$1.infer<typeof terminalResizeRequestSchema>;
declare const terminalOutputQuerySchema: z$1.ZodObject<{
    sinceSeq: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
    tailBytes: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
    limitChunks: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
}, z$1.core.$strict>;
type TerminalOutputQuery = z$1.infer<typeof terminalOutputQuerySchema>;
declare const terminalOutputResponseSchema: z$1.ZodObject<{
    chunks: z$1.ZodArray<z$1.ZodObject<{
        seq: z$1.ZodNumber;
        dataBase64: z$1.ZodString;
    }, z$1.core.$strict>>;
    nextSeq: z$1.ZodNumber;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strict>;
type TerminalOutputResponse = z$1.infer<typeof terminalOutputResponseSchema>;

declare const timelineRowStatusSchema: z$1.ZodEnum<{
    error: "error";
    pending: "pending";
    completed: "completed";
    interrupted: "interrupted";
}>;
type TimelineRowStatus = z$1.infer<typeof timelineRowStatusSchema>;
declare const timelineRowBaseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type TimelineRowBase = z$1.infer<typeof timelineRowBaseSchema>;
declare const timelineConversationRowSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"conversation">;
    text: z$1.ZodString;
    attachments: z$1.ZodNullable<z$1.ZodObject<{
        webImages: z$1.ZodNumber;
        localImages: z$1.ZodNumber;
        localFiles: z$1.ZodNumber;
        imageUrls: z$1.ZodArray<z$1.ZodString>;
        localImagePaths: z$1.ZodArray<z$1.ZodString>;
        localFilePaths: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    role: z$1.ZodLiteral<"user">;
    initiator: z$1.ZodEnum<{
        user: "user";
        agent: "agent";
        system: "system";
    }>;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    systemMessageKind: z$1.ZodEnum<{
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        "child-needs-attention": "child-needs-attention";
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-outcome-batch": "child-outcome-batch";
        unlabeled: "unlabeled";
    }>;
    systemMessageSubject: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-batch">;
        count: z$1.ZodNumber;
    }, z$1.core.$strip>], "kind">>;
    turnRequest: z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            message: "message";
            steer: "steer";
        }>;
        status: z$1.ZodEnum<{
            pending: "pending";
            accepted: "accepted";
        }>;
    }, z$1.core.$strip>;
    mentions: z$1.ZodArray<z$1.ZodObject<{
        start: z$1.ZodNumber;
        end: z$1.ZodNumber;
        resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            threadId: z$1.ZodString;
            projectId: z$1.ZodOptional<z$1.ZodString>;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"project">;
            projectId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"section">;
            sectionId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"path">;
            source: z$1.ZodEnum<{
                workspace: "workspace";
                "thread-storage": "thread-storage";
            }>;
            entryKind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z$1.ZodEnum<{
                user: "user";
                project: "project";
                builtin: "builtin";
            }>;
            label: z$1.ZodString;
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
            itemId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"conversation">;
    text: z$1.ZodString;
    attachments: z$1.ZodNullable<z$1.ZodObject<{
        webImages: z$1.ZodNumber;
        localImages: z$1.ZodNumber;
        localFiles: z$1.ZodNumber;
        imageUrls: z$1.ZodArray<z$1.ZodString>;
        localImagePaths: z$1.ZodArray<z$1.ZodString>;
        localFilePaths: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    role: z$1.ZodLiteral<"assistant">;
    turnRequest: z$1.ZodNull;
}, z$1.core.$strip>], "role">;
type TimelineConversationRow = z$1.infer<typeof timelineConversationRowSchema>;
declare const timelineSystemRowSchema: z$1.ZodUnion<readonly [z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"system">;
    title: z$1.ZodString;
    detail: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodNullable<z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>>;
    systemKind: z$1.ZodEnum<{
        error: "error";
        debug: "debug";
        reconnect: "reconnect";
    }>;
}, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"system">;
    title: z$1.ZodString;
    detail: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodNullable<z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>>;
    systemKind: z$1.ZodLiteral<"operation">;
    operationKind: z$1.ZodEnum<{
        generic: "generic";
        compaction: "compaction";
        "thread-provisioning": "thread-provisioning";
        "thread-interrupted": "thread-interrupted";
        "provider-unhandled": "provider-unhandled";
        warning: "warning";
        deprecation: "deprecation";
    }>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"system">;
    title: z$1.ZodString;
    detail: z$1.ZodNullable<z$1.ZodString>;
    systemKind: z$1.ZodLiteral<"operation">;
    operationKind: z$1.ZodLiteral<"parent-change">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    parentChange: z$1.ZodObject<{
        action: z$1.ZodEnum<{
            assign: "assign";
            release: "release";
            transfer: "transfer";
        }>;
        previousParentThreadId: z$1.ZodNullable<z$1.ZodString>;
        previousParentThreadTitle: z$1.ZodNullable<z$1.ZodString>;
        nextParentThreadId: z$1.ZodNullable<z$1.ZodString>;
        nextParentThreadTitle: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>], "operationKind">]>;
type TimelineSystemRow = z$1.infer<typeof timelineSystemRowSchema>;
interface TimelineWorkRowBase extends TimelineRowBase {
    kind: "work";
    status: TimelineRowStatus;
}
declare const timelineCommandWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"command">;
    callId: z$1.ZodString;
    command: z$1.ZodString;
    cwd: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodNullable<z$1.ZodString>;
    output: z$1.ZodString;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
    activityIntents: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"read">;
        command: z$1.ZodString;
        name: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"list_files">;
        command: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"search">;
        command: z$1.ZodString;
        query: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"unknown">;
        command: z$1.ZodString;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type TimelineCommandWorkRow = z$1.infer<typeof timelineCommandWorkRowSchema>;
declare const timelineToolWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"tool">;
    callId: z$1.ZodString;
    toolName: z$1.ZodString;
    toolArgs: z$1.ZodNullable<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue, unknown, z$1.core.$ZodTypeInternals<JsonValue, unknown>>>>;
    output: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
    activityIntents: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"read">;
        command: z$1.ZodString;
        name: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"list_files">;
        command: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"search">;
        command: z$1.ZodString;
        query: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"unknown">;
        command: z$1.ZodString;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type TimelineToolWorkRow = z$1.infer<typeof timelineToolWorkRowSchema>;
declare const timelineFileChangeWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"file-change">;
    callId: z$1.ZodString;
    change: z$1.ZodObject<{
        path: z$1.ZodString;
        kind: z$1.ZodNullable<z$1.ZodString>;
        movePath: z$1.ZodNullable<z$1.ZodString>;
        diff: z$1.ZodNullable<z$1.ZodString>;
        diffStats: z$1.ZodObject<{
            added: z$1.ZodNumber;
            removed: z$1.ZodNumber;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>;
    stdout: z$1.ZodNullable<z$1.ZodString>;
    stderr: z$1.ZodNullable<z$1.ZodString>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
}, z$1.core.$strip>;
type TimelineFileChangeWorkRow = z$1.infer<typeof timelineFileChangeWorkRowSchema>;
declare const timelineWebSearchWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"web-search">;
    callId: z$1.ZodString;
    queries: z$1.ZodArray<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineWebSearchWorkRow = z$1.infer<typeof timelineWebSearchWorkRowSchema>;
declare const timelineWebFetchWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"web-fetch">;
    callId: z$1.ZodString;
    url: z$1.ZodString;
    prompt: z$1.ZodNullable<z$1.ZodString>;
    pattern: z$1.ZodNullable<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineWebFetchWorkRow = z$1.infer<typeof timelineWebFetchWorkRowSchema>;
declare const timelineImageViewWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"image-view">;
    callId: z$1.ZodString;
    path: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineImageViewWorkRow = z$1.infer<typeof timelineImageViewWorkRowSchema>;
declare const timelineApprovalWorkRowSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"approval">;
    interactionId: z$1.ZodString;
    target: z$1.ZodObject<{
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    approvalKind: z$1.ZodLiteral<"file-edit">;
    lifecycle: z$1.ZodEnum<{
        denied: "denied";
        waiting: "waiting";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"approval">;
    interactionId: z$1.ZodString;
    target: z$1.ZodObject<{
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    approvalKind: z$1.ZodLiteral<"permission-grant">;
    lifecycle: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        denied: "denied";
        resolving: "resolving";
        granted: "granted";
    }>;
    grantScope: z$1.ZodNullable<z$1.ZodEnum<{
        turn: "turn";
        session: "session";
    }>>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>], "approvalKind">;
type TimelineApprovalWorkRow = z$1.infer<typeof timelineApprovalWorkRowSchema>;
declare const timelineQuestionWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"question">;
    interactionId: z$1.ZodString;
    lifecycle: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        answered: "answered";
    }>;
    questions: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        prompt: z$1.ZodString;
        shortLabel: z$1.ZodOptional<z$1.ZodString>;
        multiSelect: z$1.ZodBoolean;
        options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
            value: z$1.ZodString;
            label: z$1.ZodString;
            description: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>>;
        allowFreeText: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    answers: z$1.ZodNullable<z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        selected: z$1.ZodArray<z$1.ZodString>;
        freeText: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type TimelineQuestionWorkRow = z$1.infer<typeof timelineQuestionWorkRowSchema>;
interface TimelineDelegationWorkRow extends TimelineWorkRowBase {
    workKind: "delegation";
    callId: string;
    toolName: string;
    subagentType: string | null;
    description: string | null;
    output: string;
    completedAt: number | null;
    childRows: TimelineRow[];
}
/**
 * A provider background task — a dynamic workflow (Claude Code Workflow tool)
 * or a backgrounded shell command (Bash run_in_background), discriminated by
 * `taskType`. The row outlives its spawning turn: progress and terminal state
 * arrive via thread-scoped events folded into this single row. `workflow` is
 * the merged phase/agent tree, present only for workflows; null for shell
 * commands and for workflows the provider reported no progress records for
 * (degraded rendering falls back to description + summary).
 */
declare const timelineWorkflowWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"workflow">;
    itemId: z$1.ZodString;
    taskType: z$1.ZodString;
    workflowName: z$1.ZodNullable<z$1.ZodString>;
    description: z$1.ZodString;
    taskStatus: z$1.ZodEnum<{
        pending: "pending";
        completed: "completed";
        running: "running";
        paused: "paused";
        failed: "failed";
        killed: "killed";
        stopped: "stopped";
    }>;
    workflow: z$1.ZodNullable<z$1.ZodObject<{
        phases: z$1.ZodArray<z$1.ZodObject<{
            index: z$1.ZodNumber;
            title: z$1.ZodString;
            kind: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        agents: z$1.ZodArray<z$1.ZodObject<{
            index: z$1.ZodNumber;
            label: z$1.ZodString;
            state: z$1.ZodEnum<{
                running: "running";
                failed: "failed";
                queued: "queued";
                done: "done";
                skipped: "skipped";
            }>;
            model: z$1.ZodString;
            attempt: z$1.ZodNumber;
            cached: z$1.ZodBoolean;
            lastProgressAt: z$1.ZodNumber;
            phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
            phaseTitle: z$1.ZodOptional<z$1.ZodString>;
            agentType: z$1.ZodOptional<z$1.ZodString>;
            isolation: z$1.ZodOptional<z$1.ZodString>;
            queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastToolName: z$1.ZodOptional<z$1.ZodString>;
            lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
            promptPreview: z$1.ZodOptional<z$1.ZodString>;
            resultPreview: z$1.ZodOptional<z$1.ZodString>;
            error: z$1.ZodOptional<z$1.ZodString>;
            tokens: z$1.ZodOptional<z$1.ZodNumber>;
            toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    usage: z$1.ZodNullable<z$1.ZodObject<{
        totalTokens: z$1.ZodNumber;
        toolUses: z$1.ZodNumber;
        durationMs: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    summary: z$1.ZodNullable<z$1.ZodString>;
    error: z$1.ZodNullable<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineWorkflowWorkRow = z$1.infer<typeof timelineWorkflowWorkRowSchema>;
type TimelineWorkRow = TimelineCommandWorkRow | TimelineToolWorkRow | TimelineFileChangeWorkRow | TimelineWebSearchWorkRow | TimelineWebFetchWorkRow | TimelineImageViewWorkRow | TimelineApprovalWorkRow | TimelineQuestionWorkRow | TimelineDelegationWorkRow | TimelineWorkflowWorkRow;
interface TimelineTurnRow extends TimelineRowBase {
    kind: "turn";
    turnId: string;
    status: TimelineRowStatus;
    summaryCount: number;
    completedAt: number | null;
    children: TimelineRow[] | null;
}
type TimelineSourceRow = TimelineConversationRow | TimelineWorkRow | TimelineSystemRow;
type TimelineRow = TimelineSourceRow | TimelineTurnRow;

declare const createThreadRequestSchema: z$1.ZodObject<{
    projectId: z$1.ZodString;
    providerId: z$1.ZodOptional<z$1.ZodString>;
    origin: z$1.ZodEnum<{
        plugin: "plugin";
        app: "app";
        cli: "cli";
        sdk: "sdk";
    }>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>>;
    title: z$1.ZodOptional<z$1.ZodString>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        providerId: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    environment: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"reuse">;
        environmentId: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"host">;
        hostId: z$1.ZodOptional<z$1.ZodString>;
        workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"unmanaged">;
            path: z$1.ZodNullable<z$1.ZodString>;
            branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"existing">;
                name: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"new">;
                baseBranch: z$1.ZodString;
            }, z$1.core.$strict>], "kind">>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"managed-worktree">;
            baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"named">;
                name: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"default">;
            }, z$1.core.$strip>], "kind">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"personal">;
        }, z$1.core.$strip>], "type">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"project-default">;
    }, z$1.core.$strip>], "type">;
    parentThreadId: z$1.ZodOptional<z$1.ZodString>;
    sectionId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    sourceThreadId: z$1.ZodOptional<z$1.ZodString>;
    sourceSeqEnd: z$1.ZodOptional<z$1.ZodNumber>;
    startedOnBehalfOf: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        initiator: z$1.ZodEnum<{
            agent: "agent";
            system: "system";
        }>;
        senderThreadId: z$1.ZodString;
    }, z$1.core.$strip>>>;
    originKind: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>>;
    childOrigin: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>>;
}, z$1.core.$strip>;
type CreateThreadRequest = z$1.infer<typeof createThreadRequestSchema>;
declare const sendMessageRequestSchema: z$1.ZodObject<{
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    mode: z$1.ZodEnum<{
        steer: "steer";
        start: "start";
        auto: "auto";
        "queue-if-active": "queue-if-active";
        "steer-if-active": "steer-if-active";
    }>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SendMessageRequest = z$1.infer<typeof sendMessageRequestSchema>;
declare const createQueuedMessageRequestSchema: z$1.ZodObject<{
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type CreateQueuedMessageRequest = z$1.infer<typeof createQueuedMessageRequestSchema>;
declare const updateQueuedMessageRequestSchema: z$1.ZodObject<{
    expectedUpdatedAt: z$1.ZodNumber;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type UpdateQueuedMessageRequest = z$1.infer<typeof updateQueuedMessageRequestSchema>;
declare const sendQueuedMessageRequestSchema: z$1.ZodObject<{
    mode: z$1.ZodEnum<{
        steer: "steer";
        auto: "auto";
    }>;
}, z$1.core.$strip>;
type SendQueuedMessageRequest = z$1.infer<typeof sendQueuedMessageRequestSchema>;
declare const reorderQueuedMessageRequestSchema: z$1.ZodObject<{
    previousQueuedMessageId: z$1.ZodNullable<z$1.ZodString>;
    nextQueuedMessageId: z$1.ZodNullable<z$1.ZodString>;
    groupBoundaryQueuedMessageId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderQueuedMessageRequest = z$1.infer<typeof reorderQueuedMessageRequestSchema>;
declare const setQueuedMessageGroupBoundaryRequestSchema: z$1.ZodObject<{
    expectedGroupedPrefixQueuedMessageIds: z$1.ZodArray<z$1.ZodString>;
    groupBoundaryQueuedMessageId: z$1.ZodString;
}, z$1.core.$strip>;
type SetQueuedMessageGroupBoundaryRequest = z$1.infer<typeof setQueuedMessageGroupBoundaryRequestSchema>;
declare const sendQueuedMessageResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    queuedMessage: z$1.ZodObject<{
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        user: "user";
                        project: "project";
                        builtin: "builtin";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>;
        model: z$1.ZodString;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            "workspace-write": "workspace-write";
        }>;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        groupWithNext: z$1.ZodBoolean;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>;
}, z$1.core.$strip>;
type SendQueuedMessageResponse = z$1.infer<typeof sendQueuedMessageResponseSchema>;
declare const threadListResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        stopping: "stopping";
        idle: "idle";
        starting: "starting";
        active: "active";
    }>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    visibility: z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    activity: z$1.ZodObject<{
        activeWorkflowCount: z$1.ZodNumber;
        activeBackgroundAgentCount: z$1.ZodNumber;
        activeBackgroundCommandCount: z$1.ZodNumber;
        activePlanModeCount: z$1.ZodNumber;
        activeGoalCount: z$1.ZodNumber;
    }, z$1.core.$strip>;
    pinSortKey: z$1.ZodNullable<z$1.ZodString>;
    hasPendingInteraction: z$1.ZodBoolean;
    environmentHostId: z$1.ZodNullable<z$1.ZodString>;
    environmentName: z$1.ZodNullable<z$1.ZodString>;
    environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
    environmentWorkspaceDisplayKind: z$1.ZodEnum<{
        "managed-worktree": "managed-worktree";
        "unmanaged-worktree": "unmanaged-worktree";
        other: "other";
    }>;
}, z$1.core.$strip>>;
type ThreadListResponse = z$1.infer<typeof threadListResponseSchema>;
declare const threadSearchResponseSchema: z$1.ZodObject<{
    active: z$1.ZodObject<{
        total: z$1.ZodNumber;
        results: z$1.ZodArray<z$1.ZodObject<{
            thread: z$1.ZodObject<{
                id: z$1.ZodString;
                projectId: z$1.ZodString;
                environmentId: z$1.ZodNullable<z$1.ZodString>;
                providerId: z$1.ZodString;
                title: z$1.ZodNullable<z$1.ZodString>;
                titleFallback: z$1.ZodNullable<z$1.ZodString>;
                sectionId: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    error: "error";
                    stopping: "stopping";
                    idle: "idle";
                    starting: "starting";
                    active: "active";
                }>;
                parentThreadId: z$1.ZodNullable<z$1.ZodString>;
                sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
                originKind: z$1.ZodNullable<z$1.ZodEnum<{
                    "side-chat": "side-chat";
                    fork: "fork";
                }>>;
                childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
                    "side-chat": "side-chat";
                    fork: "fork";
                }>>;
                originPluginId: z$1.ZodNullable<z$1.ZodString>;
                visibility: z$1.ZodEnum<{
                    visible: "visible";
                    hidden: "hidden";
                }>;
                archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
                pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
                deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
                lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
                latestAttentionAt: z$1.ZodNumber;
                createdAt: z$1.ZodNumber;
                updatedAt: z$1.ZodNumber;
                runtime: z$1.ZodObject<{
                    displayStatus: z$1.ZodEnum<{
                        error: "error";
                        provisioning: "provisioning";
                        stopping: "stopping";
                        idle: "idle";
                        starting: "starting";
                        active: "active";
                        "host-reconnecting": "host-reconnecting";
                        "waiting-for-host": "waiting-for-host";
                    }>;
                    hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>;
                activity: z$1.ZodObject<{
                    activeWorkflowCount: z$1.ZodNumber;
                    activeBackgroundAgentCount: z$1.ZodNumber;
                    activeBackgroundCommandCount: z$1.ZodNumber;
                    activePlanModeCount: z$1.ZodNumber;
                    activeGoalCount: z$1.ZodNumber;
                }, z$1.core.$strip>;
                pinSortKey: z$1.ZodNullable<z$1.ZodString>;
                hasPendingInteraction: z$1.ZodBoolean;
                environmentHostId: z$1.ZodNullable<z$1.ZodString>;
                environmentName: z$1.ZodNullable<z$1.ZodString>;
                environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
                environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    "unmanaged-worktree": "unmanaged-worktree";
                    other: "other";
                }>;
            }, z$1.core.$strip>;
            matches: z$1.ZodArray<z$1.ZodObject<{
                sourceKind: z$1.ZodEnum<{
                    title: "title";
                    title_fallback: "title_fallback";
                    user_message: "user_message";
                    assistant_message: "assistant_message";
                    system_message: "system_message";
                }>;
                text: z$1.ZodString;
                highlightRanges: z$1.ZodArray<z$1.ZodObject<{
                    start: z$1.ZodNumber;
                    end: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                sourceSeq: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>;
    archived: z$1.ZodObject<{
        total: z$1.ZodNumber;
        results: z$1.ZodArray<z$1.ZodObject<{
            thread: z$1.ZodObject<{
                id: z$1.ZodString;
                projectId: z$1.ZodString;
                environmentId: z$1.ZodNullable<z$1.ZodString>;
                providerId: z$1.ZodString;
                title: z$1.ZodNullable<z$1.ZodString>;
                titleFallback: z$1.ZodNullable<z$1.ZodString>;
                sectionId: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    error: "error";
                    stopping: "stopping";
                    idle: "idle";
                    starting: "starting";
                    active: "active";
                }>;
                parentThreadId: z$1.ZodNullable<z$1.ZodString>;
                sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
                originKind: z$1.ZodNullable<z$1.ZodEnum<{
                    "side-chat": "side-chat";
                    fork: "fork";
                }>>;
                childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
                    "side-chat": "side-chat";
                    fork: "fork";
                }>>;
                originPluginId: z$1.ZodNullable<z$1.ZodString>;
                visibility: z$1.ZodEnum<{
                    visible: "visible";
                    hidden: "hidden";
                }>;
                archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
                pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
                deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
                lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
                latestAttentionAt: z$1.ZodNumber;
                createdAt: z$1.ZodNumber;
                updatedAt: z$1.ZodNumber;
                runtime: z$1.ZodObject<{
                    displayStatus: z$1.ZodEnum<{
                        error: "error";
                        provisioning: "provisioning";
                        stopping: "stopping";
                        idle: "idle";
                        starting: "starting";
                        active: "active";
                        "host-reconnecting": "host-reconnecting";
                        "waiting-for-host": "waiting-for-host";
                    }>;
                    hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>;
                activity: z$1.ZodObject<{
                    activeWorkflowCount: z$1.ZodNumber;
                    activeBackgroundAgentCount: z$1.ZodNumber;
                    activeBackgroundCommandCount: z$1.ZodNumber;
                    activePlanModeCount: z$1.ZodNumber;
                    activeGoalCount: z$1.ZodNumber;
                }, z$1.core.$strip>;
                pinSortKey: z$1.ZodNullable<z$1.ZodString>;
                hasPendingInteraction: z$1.ZodBoolean;
                environmentHostId: z$1.ZodNullable<z$1.ZodString>;
                environmentName: z$1.ZodNullable<z$1.ZodString>;
                environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
                environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    "unmanaged-worktree": "unmanaged-worktree";
                    other: "other";
                }>;
            }, z$1.core.$strip>;
            matches: z$1.ZodArray<z$1.ZodObject<{
                sourceKind: z$1.ZodEnum<{
                    title: "title";
                    title_fallback: "title_fallback";
                    user_message: "user_message";
                    assistant_message: "assistant_message";
                    system_message: "system_message";
                }>;
                text: z$1.ZodString;
                highlightRanges: z$1.ZodArray<z$1.ZodObject<{
                    start: z$1.ZodNumber;
                    end: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                sourceSeq: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>;
}, z$1.core.$strict>;
type ThreadSearchResponse = z$1.infer<typeof threadSearchResponseSchema>;
declare const threadResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        stopping: "stopping";
        idle: "idle";
        starting: "starting";
        active: "active";
    }>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    visibility: z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    canSpawnChild: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ThreadResponse = z$1.infer<typeof threadResponseSchema>;
declare const threadGetQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadGetQuery = z$1.infer<typeof threadGetQuerySchema>;
declare const threadWithIncludesResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        stopping: "stopping";
        idle: "idle";
        starting: "starting";
        active: "active";
    }>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    visibility: z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    canSpawnChild: z$1.ZodBoolean;
    environment: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        name: z$1.ZodNullable<z$1.ZodString>;
        projectId: z$1.ZodString;
        hostId: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
        managed: z$1.ZodBoolean;
        isGitRepo: z$1.ZodBoolean;
        isWorktree: z$1.ZodBoolean;
        workspaceProvisionType: z$1.ZodEnum<{
            personal: "personal";
            "managed-worktree": "managed-worktree";
            unmanaged: "unmanaged";
        }>;
        branchName: z$1.ZodNullable<z$1.ZodString>;
        baseBranch: z$1.ZodNullable<z$1.ZodString>;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            ready: "ready";
            retiring: "retiring";
            destroying: "destroying";
            destroyed: "destroyed";
        }>;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>>;
    host: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        name: z$1.ZodString;
        type: z$1.ZodEnum<{
            persistent: "persistent";
        }>;
        status: z$1.ZodEnum<{
            disconnected: "disconnected";
            connected: "connected";
        }>;
        lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>>;
}, z$1.core.$strip>;
type ThreadWithIncludesResponse = z$1.infer<typeof threadWithIncludesResponseSchema>;
declare const threadPendingInteractionsResponseSchema: z$1.ZodArray<z$1.ZodUnion<readonly [z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodUnion<readonly [z$1.ZodObject<{
        kind: z$1.ZodLiteral<"approval">;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            itemId: z$1.ZodString;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                type: z$1.ZodLiteral<"read">;
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"listFiles">;
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"search">;
                command: z$1.ZodString;
                query: z$1.ZodNullable<z$1.ZodString>;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"unknown">;
                command: z$1.ZodString;
            }, z$1.core.$strip>], "type">>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"file_change">;
            itemId: z$1.ZodString;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"permission_grant">;
            itemId: z$1.ZodString;
            toolName: z$1.ZodNullable<z$1.ZodString>;
            permissions: z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strip>], "kind">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_once: "allow_once";
            allow_for_session: "allow_for_session";
            deny: "deny";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>;
    resolution: z$1.ZodNullable<z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
        data: z$1.ZodType<JsonValue, unknown, z$1.core.$ZodTypeInternals<JsonValue, unknown>>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>]>>;
type ThreadPendingInteractionsResponse = z$1.infer<typeof threadPendingInteractionsResponseSchema>;
declare const threadQueuedMessageListResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    id: z$1.ZodString;
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodString;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        readonly: "readonly";
        full: "full";
        "workspace-write": "workspace-write";
    }>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    groupWithNext: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>>;
type ThreadQueuedMessageListResponse = z$1.infer<typeof threadQueuedMessageListResponseSchema>;
declare const threadChildSummaryResponseSchema: z$1.ZodObject<{
    nonDeletedChildCount: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadChildSummaryResponse = z$1.infer<typeof threadChildSummaryResponseSchema>;
declare const deleteThreadRequestSchema: z$1.ZodObject<{
    childThreadsConfirmed: z$1.ZodBoolean;
}, z$1.core.$strip>;
type DeleteThreadRequest = z$1.infer<typeof deleteThreadRequestSchema>;
declare const updateThreadRequestSchema: z$1.ZodObject<{
    title: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    sectionId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    parentThreadId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    model: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>>;
}, z$1.core.$strip>;
type UpdateThreadRequest = z$1.infer<typeof updateThreadRequestSchema>;
declare const reorderPinnedThreadRequestSchema: z$1.ZodObject<{
    previousThreadId: z$1.ZodNullable<z$1.ZodString>;
    nextThreadId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderPinnedThreadRequest = z$1.infer<typeof reorderPinnedThreadRequestSchema>;
/**
 * Requested placement for a thread opened in the app's split layout. Edge
 * placements add panes through the eighth pane; at the cap they replace the
 * focused pane. `replace` always replaces the focused pane.
 */
declare const threadOpenSplitSchema: z$1.ZodEnum<{
    right: "right";
    down: "down";
    left: "left";
    top: "top";
    replace: "replace";
}>;
type ThreadOpenSplit = z$1.infer<typeof threadOpenSplitSchema>;
/** Optional secondary-panel file to open with a thread. */
declare const threadOpenFileSchema: z$1.ZodObject<{
    source: z$1.ZodEnum<{
        workspace: "workspace";
        "thread-storage": "thread-storage";
    }>;
    path: z$1.ZodString;
    lineNumber: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strict>;
type ThreadOpenFile = z$1.infer<typeof threadOpenFileSchema>;
/** Response for POST /threads/:id/open: how many connected clients received it. */
declare const threadOpenResponseSchema: z$1.ZodObject<{
    delivered: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadOpenResponse = z$1.infer<typeof threadOpenResponseSchema>;
/** Presentation action for one thread pane in each connected app window. */
declare const threadPaneActionSchema: z$1.ZodEnum<{
    maximize: "maximize";
    restore: "restore";
    toggle: "toggle";
}>;
type ThreadPaneAction = z$1.infer<typeof threadPaneActionSchema>;
/** Number of connected app clients that received the pane action. */
declare const threadPaneActionResponseSchema: z$1.ZodObject<{
    delivered: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadPaneActionResponse = z$1.infer<typeof threadPaneActionResponseSchema>;
declare const threadArchiveAllResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    archivedThreadIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadArchiveAllResponse = z$1.infer<typeof threadArchiveAllResponseSchema>;
declare const threadListQuerySchema: z$1.ZodObject<{
    projectId: z$1.ZodOptional<z$1.ZodString>;
    parentThreadId: z$1.ZodOptional<z$1.ZodString>;
    sourceThreadId: z$1.ZodOptional<z$1.ZodString>;
    archived: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    sectionId: z$1.ZodOptional<z$1.ZodString>;
    unsectioned: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    hasParent: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    originKind: z$1.ZodOptional<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    excludeSideChats: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    childOrigin: z$1.ZodOptional<z$1.ZodEnum<{
        "side-chat": "side-chat";
        fork: "fork";
    }>>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    offset: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadListQuery = z$1.infer<typeof threadListQuerySchema>;
declare const threadSearchQuerySchema: z$1.ZodObject<{
    query: z$1.ZodString;
    limitPerGroup: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadSearchQuery = z$1.infer<typeof threadSearchQuerySchema>;
declare const threadTimelineQuerySchema: z$1.ZodObject<{
    includeNestedRows: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    segmentLimit: z$1.ZodOptional<z$1.ZodString>;
    beforeAnchorSeq: z$1.ZodOptional<z$1.ZodString>;
    beforeAnchorId: z$1.ZodOptional<z$1.ZodString>;
    summaryOnly: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    afterSequence: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadTimelineQuery = z$1.infer<typeof threadTimelineQuerySchema>;
declare const timelineTurnSummaryDetailsQuerySchema: z$1.ZodObject<{
    turnId: z$1.ZodString;
    sourceSeqStart: z$1.ZodString;
    sourceSeqEnd: z$1.ZodString;
}, z$1.core.$strip>;
type TimelineTurnSummaryDetailsQuery = z$1.infer<typeof timelineTurnSummaryDetailsQuerySchema>;
declare const threadStorageFilesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadStorageFilesQuery = z$1.infer<typeof threadStorageFilesQuerySchema>;
declare const threadStoragePathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
}, z$1.core.$strip>;
type ThreadStoragePathsQuery = z$1.infer<typeof threadStoragePathsQuerySchema>;
declare const timelineTurnSummaryDetailsResponseSchema: z$1.ZodObject<{
    rows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
}, z$1.core.$strip>;
type TimelineTurnSummaryDetailsResponse = z$1.infer<typeof timelineTurnSummaryDetailsResponseSchema>;
declare const threadTimelineResponseSchema: z$1.ZodObject<{
    rows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
    activePromptMode: z$1.ZodNullable<z$1.ZodObject<{
        mode: z$1.ZodLiteral<"plan">;
        providerId: z$1.ZodEnum<{
            codex: "codex";
            "claude-code": "claude-code";
        }>;
        prompt: z$1.ZodString;
    }, z$1.core.$strict>>;
    activeThinking: z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        text: z$1.ZodString;
        startedAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    activeWorkflow: z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        threadId: z$1.ZodString;
        turnId: z$1.ZodNullable<z$1.ZodString>;
        sourceSeqStart: z$1.ZodNumber;
        sourceSeqEnd: z$1.ZodNumber;
        startedAt: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"work">;
        status: z$1.ZodEnum<{
            error: "error";
            pending: "pending";
            completed: "completed";
            interrupted: "interrupted";
        }>;
        workKind: z$1.ZodLiteral<"workflow">;
        itemId: z$1.ZodString;
        taskType: z$1.ZodString;
        workflowName: z$1.ZodNullable<z$1.ZodString>;
        description: z$1.ZodString;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            running: "running";
            paused: "paused";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        workflow: z$1.ZodNullable<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodNullable<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        error: z$1.ZodNullable<z$1.ZodString>;
        completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    activeBackgroundCommands: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        threadId: z$1.ZodString;
        turnId: z$1.ZodNullable<z$1.ZodString>;
        sourceSeqStart: z$1.ZodNumber;
        sourceSeqEnd: z$1.ZodNumber;
        startedAt: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"work">;
        status: z$1.ZodEnum<{
            error: "error";
            pending: "pending";
            completed: "completed";
            interrupted: "interrupted";
        }>;
        workKind: z$1.ZodLiteral<"workflow">;
        itemId: z$1.ZodString;
        taskType: z$1.ZodString;
        workflowName: z$1.ZodNullable<z$1.ZodString>;
        description: z$1.ZodString;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            running: "running";
            paused: "paused";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        workflow: z$1.ZodNullable<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodNullable<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        error: z$1.ZodNullable<z$1.ZodString>;
        completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    pendingTodos: z$1.ZodNullable<z$1.ZodObject<{
        sourceSeq: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        items: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            text: z$1.ZodString;
            status: z$1.ZodEnum<{
                pending: "pending";
                completed: "completed";
                in_progress: "in_progress";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    goal: z$1.ZodNullable<z$1.ZodObject<{
        sourceSeq: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        objective: z$1.ZodString;
        status: z$1.ZodEnum<{
            active: "active";
            paused: "paused";
            budgetLimited: "budgetLimited";
            complete: "complete";
        }>;
        tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
        tokensUsed: z$1.ZodNumber;
        timeUsedSeconds: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    modelFallback: z$1.ZodNullable<z$1.ZodObject<{
        sourceSeq: z$1.ZodNumber;
        detectedAt: z$1.ZodNumber;
        originalModel: z$1.ZodString;
        fallbackModel: z$1.ZodString;
        reason: z$1.ZodEnum<{
            provider: "provider";
            refusal: "refusal";
        }>;
        message: z$1.ZodString;
    }, z$1.core.$strip>>;
    contextWindowUsage: z$1.ZodOptional<z$1.ZodObject<{
        usedTokens: z$1.ZodNumber;
        modelContextWindow: z$1.ZodNumber;
        estimated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    timelinePage: z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            latest: "latest";
            older: "older";
        }>;
        segmentLimit: z$1.ZodNumber;
        returnedSegmentCount: z$1.ZodNumber;
        hasOlderRows: z$1.ZodBoolean;
        olderCursor: z$1.ZodNullable<z$1.ZodObject<{
            anchorSeq: z$1.ZodNumber;
            anchorId: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>;
    maxSeq: z$1.ZodNumber;
    delta: z$1.ZodOptional<z$1.ZodObject<{
        upsertRows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
        rowOrder: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThreadTimelineResponse = z$1.infer<typeof threadTimelineResponseSchema>;
declare const threadConversationOutlineResponseSchema: z$1.ZodObject<{
    items: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        role: z$1.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        preview: z$1.ZodString;
        attachmentSummary: z$1.ZodNullable<z$1.ZodObject<{
            imageCount: z$1.ZodNumber;
            fileCount: z$1.ZodNumber;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    maxSeq: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadConversationOutlineResponse = z$1.infer<typeof threadConversationOutlineResponseSchema>;
declare const threadStorageFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
    storageRootPath: z$1.ZodString;
}, z$1.core.$strip>;
type ThreadStorageFileListResponse = z$1.infer<typeof threadStorageFileListResponseSchema>;
declare const threadStoragePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        path: z$1.ZodString;
        name: z$1.ZodString;
        score: z$1.ZodNumber;
        positions: z$1.ZodArray<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
    storageRootPath: z$1.ZodString;
}, z$1.core.$strip>;
type ThreadStoragePathListResponse = z$1.infer<typeof threadStoragePathListResponseSchema>;

declare const threadTabsResponseSchema: z$1.ZodObject<{
    revision: z$1.ZodNumber;
    tabs: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"thread-info">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"git-diff">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        actionId: z$1.ZodString;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"plugin-panel">;
        paramsJson: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodString;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"workspace-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"working-tree">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"head">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge-base">;
            ref: z$1.ZodString;
        }, z$1.core.$strict>], "kind">;
        statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        isPinned: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"thread-storage-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"browser">;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"new-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"side-chat">;
        sourceMessageText: z$1.ZodString;
        sourceSeqEnd: z$1.ZodNullable<z$1.ZodNumber>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"terminal">;
        terminalId: z$1.ZodString;
    }, z$1.core.$strict>], "kind">>;
}, z$1.core.$strict>;
type ThreadTabsResponse = z$1.infer<typeof threadTabsResponseSchema>;
declare const updateThreadTabsRequestSchema: z$1.ZodObject<{
    expectedRevision: z$1.ZodNumber;
    tabs: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"thread-info">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"git-diff">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        actionId: z$1.ZodString;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"plugin-panel">;
        paramsJson: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodString;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"workspace-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"working-tree">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"head">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge-base">;
            ref: z$1.ZodString;
        }, z$1.core.$strict>], "kind">;
        statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        isPinned: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"thread-storage-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"browser">;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"new-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"side-chat">;
        sourceMessageText: z$1.ZodString;
        sourceSeqEnd: z$1.ZodNullable<z$1.ZodNumber>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"terminal">;
        terminalId: z$1.ZodString;
    }, z$1.core.$strict>], "kind">>;
}, z$1.core.$strict>;
type UpdateThreadTabsRequest = z$1.infer<typeof updateThreadTabsRequestSchema>;

interface EnvironmentActionArgs {
    environmentId: string;
}
interface EnvironmentGetArgs extends EnvironmentActionArgs {
    signal?: AbortSignal;
}
type EnvironmentMergeBaseBranchUpdateValue = Exclude<UpdateEnvironmentRequest["mergeBaseBranch"], undefined>;
type EnvironmentNameUpdateValue = Exclude<UpdateEnvironmentRequest["name"], undefined>;
interface EnvironmentMergeBaseBranchUpdate {
    mergeBaseBranch: EnvironmentMergeBaseBranchUpdateValue;
    name?: EnvironmentNameUpdateValue;
}
interface EnvironmentNameUpdate {
    mergeBaseBranch?: EnvironmentMergeBaseBranchUpdateValue;
    name: EnvironmentNameUpdateValue;
}
type EnvironmentUpdateFields = EnvironmentMergeBaseBranchUpdate | EnvironmentNameUpdate;
type EnvironmentUpdateArgs = EnvironmentUpdateFields & {
    environmentId: string;
};
interface EnvironmentStatusArgs extends EnvironmentStatusQuery {
    environmentId: string;
    signal?: AbortSignal;
}
type EnvironmentDiffArgs = EnvironmentDiffQuery & {
    environmentId: string;
    signal?: AbortSignal;
};
type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
    environmentId: string;
    signal?: AbortSignal;
};
interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
    environmentId: string;
    signal?: AbortSignal;
}
interface EnvironmentCommitArgs {
    environmentId: string;
}
interface EnvironmentSquashMergeArgs {
    environmentId: string;
    mergeBaseBranch: string;
}
interface EnvironmentPullRequestMergeArgs {
    environmentId: string;
    method: PullRequestMergeMethod;
}
type EnvironmentDiffPatchArgs = EnvironmentDiffPatchRequest & {
    environmentId: string;
    signal?: AbortSignal;
};
interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
    environmentId: string;
    signal?: AbortSignal;
}
type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
type EnvironmentCommitResult = CommitActionResponse;
type EnvironmentDiffResult = EnvironmentDiffResponse;
type EnvironmentDiffBranchesResult = EnvironmentDiffBranchesResponse;
type EnvironmentDiffFileResult = EnvironmentDiffFileResponse;
type EnvironmentDiffFilesResult = EnvironmentDiffFilesResponse;
type EnvironmentDiffPatchResult = EnvironmentDiffPatchResponse;
type EnvironmentGetResult = Environment;
type EnvironmentMarkPullRequestDraftResult = PullRequestDraftActionResponse;
type EnvironmentMarkPullRequestReadyResult = PullRequestReadyActionResponse;
type EnvironmentMergePullRequestResult = PullRequestMergeActionResponse;
type EnvironmentPathsResult = WorkspacePathListResponse;
type EnvironmentPullRequestResult = EnvironmentPullRequestResponse;
type EnvironmentSquashMergeResult = SquashMergeActionResponse;
type EnvironmentStatusResult = EnvironmentStatusResponse;
type EnvironmentUpdateResult = Environment;
interface EnvironmentsArea {
    archiveThreads(args: EnvironmentActionArgs): Promise<EnvironmentArchiveThreadsResult>;
    commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
    diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
    diffBranches(args: EnvironmentDiffBranchesArgs): Promise<EnvironmentDiffBranchesResult>;
    diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
    diffFiles(args: EnvironmentDiffArgs): Promise<EnvironmentDiffFilesResult>;
    diffPatch(args: EnvironmentDiffPatchArgs): Promise<EnvironmentDiffPatchResult>;
    get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
    pullRequest(args: EnvironmentGetArgs): Promise<EnvironmentPullRequestResult>;
    markPullRequestDraft(args: EnvironmentActionArgs): Promise<EnvironmentMarkPullRequestDraftResult>;
    markPullRequestReady(args: EnvironmentActionArgs): Promise<EnvironmentMarkPullRequestReadyResult>;
    mergePullRequest(args: EnvironmentPullRequestMergeArgs): Promise<EnvironmentMergePullRequestResult>;
    paths(args: EnvironmentPathsArgs): Promise<EnvironmentPathsResult>;
    squashMerge(args: EnvironmentSquashMergeArgs): Promise<EnvironmentSquashMergeResult>;
    status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
    update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}

/**
 * Host file primitives. `hostId` may be omitted to target the server's
 * primary (local) host. `rootPath`, when set, confines the target beneath
 * that absolute root on the host (symlink-safe).
 */
interface FileReadArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    signal?: AbortSignal;
}
interface FileWriteArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    content: string;
    /** Defaults to "utf8". */
    contentEncoding?: "utf8" | "base64";
    /** Defaults to false. */
    createParents?: boolean;
    /**
     * Optimistic-concurrency guard: omitted → unconditional write; a hash →
     * write only when the current content hashes to it (use `read().sha256`);
     * null → create-only. A failed guard resolves to the `conflict` outcome.
     */
    expectedSha256?: string | null;
    /** POSIX permission bits used when creating a file (for example 0o600). */
    mode?: number;
}
interface FileListArgs {
    hostId?: string;
    path: string;
    query?: string;
    limit?: number;
    signal?: AbortSignal;
}
interface PathListArgs extends FileListArgs {
    includeFiles: boolean;
    includeDirectories: boolean;
}
interface FileMkdirArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    recursive?: boolean;
}
interface FileMoveArgs {
    hostId?: string;
    sourcePath: string;
    destinationPath: string;
    rootPath?: string;
}
interface FileRemoveArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    recursive?: boolean;
}
interface FilePreviewArgs {
    hostId?: string;
    rootPath: string;
    signal?: AbortSignal;
    ttlMs?: number;
}
type FileReadResult = HostFileReadResponse;
type FileWriteResult = HostFileWriteResponse;
type FileListResult = HostFileListResponse;
type PathListResult = HostPathListResponse;
type FileMkdirResult = HostMkdirResponse;
type FileMoveResult = HostMovePathResponse;
type FileRemoveResult = HostRemovePathResponse;
type FilePreviewResult = CreateFilePreviewResponse;
interface FilesArea {
    read(args: FileReadArgs): Promise<FileReadResult>;
    write(args: FileWriteArgs): Promise<FileWriteResult>;
    list(args: FileListArgs): Promise<FileListResult>;
    listPaths(args: PathListArgs): Promise<PathListResult>;
    mkdir(args: FileMkdirArgs): Promise<FileMkdirResult>;
    move(args: FileMoveArgs): Promise<FileMoveResult>;
    remove(args: FileRemoveArgs): Promise<FileRemoveResult>;
    createPreview(args: FilePreviewArgs): Promise<FilePreviewResult>;
}

interface GuideRenderArgs {
    chapter?: string;
}
interface GuideRenderResult {
    chapter?: string;
    content: string;
}
interface GuideArea {
    render(args?: GuideRenderArgs): GuideRenderResult;
}

interface HostGetArgs {
    hostId: string;
    signal?: AbortSignal;
}
interface HostDeleteArgs {
    hostId: string;
}
interface HostUpdateArgs extends UpdateHostRequest {
    hostId: string;
}
interface HostDirectoryArgs extends HostDirectoryQuery {
    hostId: string;
    signal?: AbortSignal;
}
interface HostCloneDefaultPathArgs extends HostCloneDefaultPathQuery {
    hostId: string;
    signal?: AbortSignal;
}
interface HostPathsExistArgs extends HostPathsExistRequest {
    hostId: string;
    signal?: AbortSignal;
}
interface HostPickFolderArgs extends HostPickFolderRequest {
    hostId: string;
    signal?: AbortSignal;
}
interface HostProviderCliInstallArgs extends HostProviderCliInstallRequest {
    hostId: string;
}
interface HostListArgs {
    signal?: AbortSignal;
}
type HostCreateJoinCodeResult = CreateHostJoinCodeResponse;
type HostDeleteResult = {
    ok: true;
};
type HostDirectoryResult = HostDirectoryListing;
type HostGetResult = Host;
type HostCloneDefaultPathResult = HostCloneDefaultPathResponse;
type HostProviderCliInstallResult = HostProviderCliInstallEvent[];
type HostListResult = Host[];
type HostPathsExistResult = HostPathsExistResponse;
type HostPickFolderResult = HostPickFolderResponse;
type HostProviderCliStatusResult = HostProviderCliStatusResponse;
type HostUpdateResult = Host;
interface HostsArea {
    createJoinCode(): Promise<HostCreateJoinCodeResult>;
    delete(args: HostDeleteArgs): Promise<HostDeleteResult>;
    directory(args: HostDirectoryArgs): Promise<HostDirectoryResult>;
    get(args: HostGetArgs): Promise<HostGetResult>;
    cloneDefaultPath(args: HostCloneDefaultPathArgs): Promise<HostCloneDefaultPathResult>;
    installProviderCli(args: HostProviderCliInstallArgs): Promise<HostProviderCliInstallResult>;
    list(args?: HostListArgs): Promise<HostListResult>;
    pathsExist(args: HostPathsExistArgs): Promise<HostPathsExistResult>;
    pickFolder(args: HostPickFolderArgs): Promise<HostPickFolderResult>;
    providerCliStatus(args: HostGetArgs): Promise<HostProviderCliStatusResult>;
    update(args: HostUpdateArgs): Promise<HostUpdateResult>;
}

interface ProjectListArgs {
    include?: ProjectListQuery["include"];
    /** Include the singleton personal project. Defaults to false for compatibility. */
    includePersonal?: boolean;
    signal?: AbortSignal;
}
interface ProjectCreateArgs extends CreateProjectRequest {
}
interface ProjectGetArgs {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectUpdateArgs extends UpdateProjectRequest {
    projectId: string;
}
interface ProjectDeleteArgs {
    projectId: string;
}
interface ProjectReorderArgs extends ReorderProjectRequest {
    projectId: string;
}
interface ProjectPromptHistoryArgs extends PromptHistoryQuery {
    projectId: string;
    signal?: AbortSignal;
}
/** Select one project workspace source, or omit both for the primary host. */
type ProjectWorkspaceRoutingArgs = {
    environmentId: string;
    hostId?: never;
} | {
    environmentId?: never;
    hostId: string;
} | {
    environmentId?: never;
    hostId?: never;
};
type ProjectFilesArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectFilesQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectPathsArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectPathsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectCommandsArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectCommandsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectFileContentArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectFileContentQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
interface ProjectBranchesArgs extends ProjectBranchesQuery {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectDefaultExecutionOptionsArgs {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectAttachmentFileLike {
    arrayBuffer(): Promise<ArrayBuffer>;
    readonly name: string;
    readonly type?: string;
}
interface ProjectAttachmentUploadArgsBase {
    /** MIME override. Omit to use the File/Blob type, when available. */
    mimeType?: string;
    projectId: string;
}
/**
 * Upload bytes owned by this SDK client. A bare Blob/byte buffer needs an
 * explicit filename; File-like values can supply their own name.
 */
type ProjectAttachmentUploadArgs = ProjectAttachmentUploadArgsBase & ({
    clientFile: ProjectAttachmentFileLike;
    filename?: string;
} | {
    clientFile: ArrayBuffer | Blob | Uint8Array;
    filename: string;
});
interface ProjectAttachmentReadArgs {
    path: string;
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectAttachmentCopyArgs extends CopyProjectAttachmentsRequest {
    projectId: string;
}
type ProjectSourceAddArgs = CreateProjectSourceRequest & {
    projectId: string;
};
interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
    projectId: string;
    sourceId: string;
}
interface ProjectSourceDeleteArgs {
    projectId: string;
    sourceId: string;
}
type ProjectBranchesResult = ProjectBranchesResponse;
interface ProjectAttachmentReadResult {
    bytes: Uint8Array;
    mimeType: string;
    sizeBytes: number;
}
type ProjectAttachmentUploadResult = UploadedPromptAttachment;
type ProjectCommandsResult = CommandListResponse;
type ProjectCreateResult = ProjectResponse;
type ProjectDefaultExecutionOptionsResult = ProjectExecutionDefaults | null;
type ProjectDeleteResult = {
    ok: true;
};
interface ProjectFileContentResult {
    /** UTF-8 text or base64, as selected by `contentEncoding`. */
    content: string;
    contentEncoding: "utf8" | "base64";
    mimeType: string;
    sizeBytes: number;
}
type ProjectFilesResult = WorkspaceFileListResponse;
type ProjectGetResult = ProjectResponse;
type ProjectListResult = ProjectResponse[] | ProjectWithThreadsResponse[];
type ProjectPathsResult = WorkspacePathListResponse;
type ProjectPromptHistoryResult = PromptHistoryResponse;
type ProjectReorderResult = ProjectResponse[];
type ProjectSourceAddResult = ProjectSource;
type ProjectSourceDeleteResult = {
    ok: true;
};
type ProjectSourceUpdateResult = ProjectSource;
type ProjectUpdateResult = ProjectResponse;
interface ProjectSourcesArea {
    add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
    delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
    update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}
interface ProjectAttachmentsArea {
    copy(args: ProjectAttachmentCopyArgs): Promise<void>;
    read(args: ProjectAttachmentReadArgs): Promise<ProjectAttachmentReadResult>;
    upload(args: ProjectAttachmentUploadArgs): Promise<ProjectAttachmentUploadResult>;
}
interface ProjectsArea {
    attachments: ProjectAttachmentsArea;
    branches(args: ProjectBranchesArgs): Promise<ProjectBranchesResult>;
    commands(args: ProjectCommandsArgs): Promise<ProjectCommandsResult>;
    create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
    defaultExecutionOptions(args: ProjectDefaultExecutionOptionsArgs): Promise<ProjectDefaultExecutionOptionsResult>;
    delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
    fileContent(args: ProjectFileContentArgs): Promise<ProjectFileContentResult>;
    files(args: ProjectFilesArgs): Promise<ProjectFilesResult>;
    get(args: ProjectGetArgs): Promise<ProjectGetResult>;
    list(args?: ProjectListArgs): Promise<ProjectListResult>;
    paths(args: ProjectPathsArgs): Promise<ProjectPathsResult>;
    promptHistory(args: ProjectPromptHistoryArgs): Promise<ProjectPromptHistoryResult>;
    reorder(args: ProjectReorderArgs): Promise<ProjectReorderResult>;
    sources: ProjectSourcesArea;
    update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

/** Select exactly one provider-discovery host source, or omit both for primary. */
type ProviderHostRoutingArgs = {
    environmentId: string;
    hostId?: never;
} | {
    environmentId?: never;
    hostId: string;
} | {
    environmentId?: never;
    hostId?: never;
};
type ProviderListArgs = ProviderHostRoutingArgs & {
    signal?: AbortSignal;
};
type ProviderModelsArgs = ProviderHostRoutingArgs & {
    providerId?: string;
    signal?: AbortSignal;
};
type ProviderListResult = ProviderInfo[];
type ProviderModelsResult = SystemExecutionOptionsResponse;
interface ProvidersArea {
    /** List providers on the environment host, explicit host, or primary host. */
    list(args?: ProviderListArgs): Promise<ProviderListResult>;
    /** List models on the environment host, explicit host, or primary host. */
    models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

interface PluginIdArgs {
    pluginId: string;
}
/** Install directly from a path:, git:, npm:, or builtin: source spec. */
interface PluginInstallArgs {
    source: string;
}
/** Install an entry from BB's official catalog. */
interface PluginCatalogInstallArgs {
    entryId: string;
}
interface PluginReloadArgs {
    pluginId?: string;
}
interface PluginSettingsUpdateArgs extends PluginIdArgs {
    values: Record<string, JsonValue>;
}
interface PluginTokenArgs extends PluginIdArgs {
    rotate?: boolean;
}
interface PluginCheckUpdatesArgs {
    pluginId?: string;
    signal?: AbortSignal;
}
interface PluginRpcArgs<TOutput> extends PluginIdArgs {
    input?: JsonValue;
    method: string;
    outputSchema: z$1.ZodType<TOutput>;
}
interface PluginCatalogSearchArgs {
    query: string;
    signal?: AbortSignal;
}
interface PluginCatalogStatusArgs {
    signal?: AbortSignal;
}
interface PluginGetSettingsArgs extends PluginIdArgs {
    signal?: AbortSignal;
}
interface PluginGetSourceArgs extends PluginIdArgs {
    signal?: AbortSignal;
}
interface PluginListArgs {
    signal?: AbortSignal;
}
interface PluginListUpdateResultsArgs {
    signal?: AbortSignal;
}
type PluginDisableResult = InstalledPlugin;
type PluginEnableResult = InstalledPlugin;
type PluginGetSettingsResult = PluginSettingsResponse;
type PluginInstallResult = InstalledPlugin;
type PluginListResult = PluginListResponse;
type PluginReloadResult = PluginReloadResponse;
type PluginRemoveResult = PluginRemoveResponse;
type PluginTokenResult = PluginTokenResponse;
type PluginUpdateSettingsResult = PluginSettingsResponse;
type PluginGetSourceResult = PluginSourceDetail;
type PluginCheckUpdatesResult = PluginUpdateCheckEntry[];
type PluginApplyUpdateResult = PluginApplyUpdateResult$1;
type PluginCatalogStatusResult = PluginCatalogStatus;
type PluginCatalogSearchResult = PluginCatalogSearchResult$1[];
interface PluginCatalogArea {
    install(args: PluginCatalogInstallArgs): Promise<PluginInstallResult>;
    search(args: PluginCatalogSearchArgs): Promise<PluginCatalogSearchResult>;
    status(args?: PluginCatalogStatusArgs): Promise<PluginCatalogStatusResult>;
}
interface PluginsArea {
    applyUpdate(args: PluginIdArgs): Promise<PluginApplyUpdateResult>;
    callRpc<TOutput>(args: PluginRpcArgs<TOutput>): Promise<TOutput>;
    checkUpdates(args?: PluginCheckUpdatesArgs): Promise<PluginCheckUpdatesResult>;
    catalog: PluginCatalogArea;
    disable(args: PluginIdArgs): Promise<PluginDisableResult>;
    enable(args: PluginIdArgs): Promise<PluginEnableResult>;
    getSettings(args: PluginGetSettingsArgs): Promise<PluginGetSettingsResult>;
    getSource(args: PluginGetSourceArgs): Promise<PluginGetSourceResult>;
    install(args: PluginInstallArgs): Promise<PluginInstallResult>;
    list(args?: PluginListArgs): Promise<PluginListResult>;
    listUpdateResults(args?: PluginListUpdateResultsArgs): Promise<PluginCheckUpdatesResult>;
    reload(args?: PluginReloadArgs): Promise<PluginReloadResult>;
    remove(args: PluginIdArgs): Promise<PluginRemoveResult>;
    token(args: PluginTokenArgs): Promise<PluginTokenResult>;
    updateSettings(args: PluginSettingsUpdateArgs): Promise<PluginUpdateSettingsResult>;
}

type BbRealtimeUnsubscribe = () => void;
type BbRealtimeEventName = "thread:changed" | "project:changed" | "environment:changed" | "host:changed" | "system:changed" | "system:config-changed" | "realtime:connection";
type ThreadRealtimeEvent = Extract<ChangedMessage, {
    entity: "thread";
}>;
type ProjectRealtimeEvent = Extract<ChangedMessage, {
    entity: "project";
}>;
type EnvironmentRealtimeEvent = Extract<ChangedMessage, {
    entity: "environment";
}>;
type HostRealtimeEvent = Extract<ChangedMessage, {
    entity: "host";
}>;
type SystemRealtimeEvent = Extract<ChangedMessage, {
    entity: "system";
}>;
type BbRealtimeConnectionState = "connecting" | "connected" | "disconnected";
interface BbRealtimeConnectionEvent {
    reconnectDelayMs: number | null;
    reconnected: boolean;
    state: BbRealtimeConnectionState;
}
/**
 * Entity-changed events are delivered as one shared object to every matching
 * listener; their payload types are readonly so a listener cannot mutate what
 * the next listener receives.
 */
interface BbRealtimeEventMap {
    "thread:changed": ThreadRealtimeEvent;
    "project:changed": ProjectRealtimeEvent;
    "environment:changed": EnvironmentRealtimeEvent;
    "host:changed": HostRealtimeEvent;
    "system:changed": SystemRealtimeEvent;
    "system:config-changed": SystemRealtimeEvent;
    "realtime:connection": BbRealtimeConnectionEvent;
}
type BbRealtimeCallback<TEventName extends BbRealtimeEventName> = (event: BbRealtimeEventMap[TEventName]) => void;
interface ThreadRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"thread:changed">;
    event: "thread:changed";
    threadId?: string;
}
interface ProjectRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"project:changed">;
    event: "project:changed";
    projectId?: string;
}
interface EnvironmentRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"environment:changed">;
    environmentId?: string;
    event: "environment:changed";
}
interface HostRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"host:changed">;
    event: "host:changed";
    hostId?: string;
}
interface SystemRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"system:changed">;
    event: "system:changed";
}
interface SystemConfigRealtimeSubscribeArgs {
    callback: BbRealtimeCallback<"system:config-changed">;
    event: "system:config-changed";
}
/**
 * Connection listeners are pure observers — they never open or hold the
 * socket. A listener registered while a socket already exists receives the
 * latest connection event as a snapshot on the next microtask, so a status
 * UI mounted after connect still learns the current state.
 */
interface RealtimeConnectionSubscribeArgs {
    callback: BbRealtimeCallback<"realtime:connection">;
    event: "realtime:connection";
}
type BbRealtimeSubscribeArgsUnion = ThreadRealtimeSubscribeArgs | ProjectRealtimeSubscribeArgs | EnvironmentRealtimeSubscribeArgs | HostRealtimeSubscribeArgs | SystemRealtimeSubscribeArgs | SystemConfigRealtimeSubscribeArgs | RealtimeConnectionSubscribeArgs;
type BbRealtimeSubscribeArgs<TEventName extends BbRealtimeEventName = BbRealtimeEventName> = Extract<BbRealtimeSubscribeArgsUnion, {
    event: TEventName;
}>;
interface BbRealtime {
    subscribe<TEventName extends BbRealtimeEventName>(args: BbRealtimeSubscribeArgs<TEventName>): BbRealtimeUnsubscribe;
}

interface StatusGetArgs {
    projectId?: string;
    signal?: AbortSignal;
    threadId?: string;
}
interface StatusThreadSummary {
    environmentId: string | null;
    id: string;
    parentThreadId: string | null;
    pinnedAt: number | null;
    projectId: string;
    status: ThreadStatus;
    title: string | null;
}
type StatusProject = ProjectResponse;
type StatusChildThreads = ThreadListResponse;
interface StatusResult {
    childThreads: StatusChildThreads | null;
    pendingTodos: ThreadTimelinePendingTodos | null;
    project: StatusProject | null;
    thread: StatusThreadSummary | null;
}
interface StatusArea {
    get(args?: StatusGetArgs): Promise<StatusResult>;
}

type ThemeGetResult = AppTheme;
type ThemeCatalogResult = ThemeCatalogResponse;
type ThemeSetInput = AppThemeSelection;
type ThemeSetResult = AppTheme;
interface ThemeCatalogArgs {
    signal?: AbortSignal;
}
interface ThemeGetArgs {
    signal?: AbortSignal;
}
interface ThemeArea {
    /** The active app palette, resolved server-side (built-in id or custom CSS). */
    get(args?: ThemeGetArgs): Promise<ThemeGetResult>;
    /** The custom-theme directory plus discovered themes and the active palette. */
    catalog(args?: ThemeCatalogArgs): Promise<ThemeCatalogResult>;
    /** Set the complete app appearance selection in one request. */
    set(selection: ThemeSetInput): Promise<ThemeSetResult>;
    /**
     * Activate a palette by id while preserving the active favicon color. This
     * compatibility shorthand reads the active appearance before writing the
     * complete selection; prefer the object form when both values are known.
     */
    set(themeId: string): Promise<ThemeSetResult>;
}

interface SystemAttentionArgs {
    signal?: AbortSignal;
}
interface SystemConfigArgs {
    signal?: AbortSignal;
}
interface SystemExecutionOptionsArgs extends SystemExecutionOptionsQuery {
    signal?: AbortSignal;
}
interface SystemUsageLimitsArgs extends SystemUsageLimitsQuery {
    signal?: AbortSignal;
}
interface SystemVersionArgs {
    force?: boolean;
    signal?: AbortSignal;
}
interface SystemVoiceTranscriptionArgs {
    file: Blob;
    prompt?: string;
    signal?: AbortSignal;
}
type SystemAttentionResult = SystemAttentionResponse;
type SystemConfigResult = SystemConfigResponse;
type SystemExecutionOptionsResult = SystemExecutionOptionsResponse;
type SystemReloadConfigResult = SystemConfigReloadResponse;
type SystemVoiceTranscriptionResult = SystemVoiceTranscriptionResponse;
type SystemUpdateExperimentsResult = Experiments;
type SystemUpdateGeneralSettingsResult = AppSettings;
type SystemUpdateKeyboardSettingsResult = AppKeybindingOverrides;
type SystemUsageLimitsResult = ProviderUsageResponse;
type SystemVersionResult = SystemVersionResponse;
interface SystemArea {
    attention(args?: SystemAttentionArgs): Promise<SystemAttentionResult>;
    config(args?: SystemConfigArgs): Promise<SystemConfigResult>;
    executionOptions(args?: SystemExecutionOptionsArgs): Promise<SystemExecutionOptionsResult>;
    reloadConfig(): Promise<SystemReloadConfigResult>;
    transcribeVoice(args: SystemVoiceTranscriptionArgs): Promise<SystemVoiceTranscriptionResult>;
    updateExperiments(args: Experiments): Promise<SystemUpdateExperimentsResult>;
    updateGeneralSettings(args: AppSettings): Promise<SystemUpdateGeneralSettingsResult>;
    updateKeyboardSettings(args: AppKeybindingOverrides): Promise<SystemUpdateKeyboardSettingsResult>;
    usageLimits(args?: SystemUsageLimitsArgs): Promise<SystemUsageLimitsResult>;
    version(args?: SystemVersionArgs): Promise<SystemVersionResult>;
}

interface TerminalThreadScope {
    cwd?: never;
    environmentId?: never;
    hostId?: never;
    kind: "thread";
    threadId: string;
}
interface TerminalEnvironmentScope {
    environmentId: string;
    cwd?: never;
    hostId?: never;
    kind: "environment";
    threadId?: never;
}
interface TerminalHostPathListScope {
    /** Optional exact initial working-directory filter on the selected host. */
    cwd?: string;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
interface TerminalHostPathCreateScope {
    /** Null starts in the selected host's home directory. */
    cwd: string | null;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
type TerminalListScope = TerminalThreadScope | TerminalEnvironmentScope | TerminalHostPathListScope;
type TerminalCreateScope = TerminalThreadScope | TerminalEnvironmentScope | TerminalHostPathCreateScope;
interface TerminalListArgs {
    signal?: AbortSignal;
    scope: TerminalListScope;
}
interface TerminalCreateArgs {
    cols: number;
    rows: number;
    scope: TerminalCreateScope;
    start?: CreateTerminalRequest["start"];
    title?: string;
}
interface TerminalTargetArgs {
    terminalId: string;
}
interface TerminalGetArgs extends TerminalTargetArgs {
    signal?: AbortSignal;
}
interface TerminalRenameArgs extends TerminalTargetArgs {
    title: UpdateTerminalRequest["title"];
}
interface TerminalCloseArgs extends TerminalTargetArgs {
    mode: "force" | "if-clean";
}
interface TerminalInputArgs extends TerminalTargetArgs {
    dataBase64: TerminalInputRequest["dataBase64"];
}
interface TerminalResizeArgs extends TerminalTargetArgs {
    cols: TerminalResizeRequest["cols"];
    rows: TerminalResizeRequest["rows"];
}
interface TerminalOutputArgs extends TerminalTargetArgs {
    limitChunks?: TerminalOutputQuery["limitChunks"];
    signal?: AbortSignal;
    sinceSeq?: TerminalOutputQuery["sinceSeq"];
    tailBytes?: TerminalOutputQuery["tailBytes"];
}
type TerminalRestartArgs = TerminalTargetArgs;
type TerminalListResult = TerminalListResponse;
type TerminalCreateResult = TerminalSession;
type TerminalGetResult = TerminalSession;
type TerminalRenameResult = TerminalSession;
type TerminalCloseResult = TerminalSession;
type TerminalInputResult = TerminalSession;
type TerminalResizeResult = TerminalSession;
type TerminalOutputResult = TerminalOutputResponse;
type TerminalRestartResult = TerminalSession;
interface TerminalsArea {
    close(args: TerminalCloseArgs): Promise<TerminalCloseResult>;
    create(args: TerminalCreateArgs): Promise<TerminalCreateResult>;
    get(args: TerminalGetArgs): Promise<TerminalGetResult>;
    input(args: TerminalInputArgs): Promise<TerminalInputResult>;
    list(args: TerminalListArgs): Promise<TerminalListResult>;
    output(args: TerminalOutputArgs): Promise<TerminalOutputResult>;
    rename(args: TerminalRenameArgs): Promise<TerminalRenameResult>;
    /**
     * Replace a terminal with a shell at the same scope, size, and title.
     * The original command is not replayed because terminal sessions do not
     * persist launch commands. The replacement has a new terminal ID.
     */
    restart(args: TerminalRestartArgs): Promise<TerminalRestartResult>;
    resize(args: TerminalResizeArgs): Promise<TerminalResizeResult>;
}

interface ThreadListArgs {
    archived?: boolean;
    excludeSideChats?: boolean;
    sectionId?: string;
    hasParent?: boolean;
    limit?: number;
    offset?: number;
    originKind?: ThreadListQuery["originKind"];
    parentThreadId?: string;
    projectId?: string;
    signal?: AbortSignal;
    sourceThreadId?: string;
    unsectioned?: boolean;
}
interface ThreadSearchArgs extends ThreadSearchQuery {
    signal?: AbortSignal;
}
interface ThreadGetArgs {
    include?: ThreadGetQuery["include"];
    signal?: AbortSignal;
    threadId: string;
}
type ThreadGetResult = ThreadResponse | ThreadWithIncludesResponse;
type ThreadListResult = ThreadListResponse;
type ThreadSearchResult = ThreadSearchResponse;
interface ThreadOutputResponse {
    output: string | null;
}
type ThreadMutationResult = ThreadResponse;
type ThreadSpawnResult = ThreadResponse;
type ThreadInteractionGetResult = PendingInteraction;
type ThreadInteractionListResult = ThreadPendingInteractionsResponse;
type ThreadInteractionResolveResult = PendingInteraction;
type ThreadInteractionRespondResult = PendingInteraction;
type ThreadInteractionCancelResult = PendingInteraction;
type ThreadEventsListResult = ThreadEventRow[];
type ThreadEventWaitResult = ThreadEventRow | null;
type ThreadTimelineResult = ThreadTimelineResponse;
type ThreadArchiveResult = ThreadArchiveAllResponse;
type ThreadOpenResult = ThreadOpenResponse;
type ThreadPaneActionResult = ThreadPaneActionResponse;
type ThreadDeleteResult = {
    ok: true;
};
type ThreadSendResult = {
    ok: true;
};
type ThreadStopResult = {
    ok: true;
};
type ThreadUnarchiveResult = {
    ok: true;
};
type ThreadArchiveAllResult = ThreadArchiveAllResponse;
type ThreadReadStateResult = ThreadResponse;
type ThreadPinOrderResult = ThreadListResponse;
type ThreadPromptHistoryResult = PromptHistoryResponse;
type ThreadQueuedMessagesResult = ThreadQueuedMessageListResponse;
type ThreadQueuedMessageCreateResult = ThreadQueuedMessage;
type ThreadQueuedMessageUpdateResult = ThreadQueuedMessage;
type ThreadQueuedMessageDeleteResult = {
    ok: true;
};
type ThreadQueuedMessageReorderResult = ThreadQueuedMessageListResponse;
type ThreadQueuedMessageSendResult = SendQueuedMessageResponse;
type ThreadQueuedMessageGroupBoundaryResult = ThreadQueuedMessageListResponse;
type ThreadTabsResult = ThreadTabsResponse;
type ThreadTabsUpdateResult = ThreadTabsResponse;
type ThreadStorageFilesResult = ThreadStorageFileListResponse;
type ThreadStoragePathsResult = ThreadStoragePathListResponse;
type ThreadChildSummaryResult = ThreadChildSummaryResponse;
type ThreadDefaultExecutionOptionsResult = ResolvedThreadExecutionOptions | null;
type ThreadConversationOutlineResult = ThreadConversationOutlineResponse;
type ThreadTimelineTurnSummaryDetailsResult = TimelineTurnSummaryDetailsResponse;
interface ThreadSpawnBaseArgs extends Omit<CreateThreadRequest, "childOrigin" | "input" | "origin" | "originKind" | "startedOnBehalfOf"> {
    childOrigin?: CreateThreadRequest["childOrigin"];
    origin?: CreateThreadRequest["origin"];
    originKind?: CreateThreadRequest["originKind"];
    startedOnBehalfOf?: CreateThreadRequest["startedOnBehalfOf"];
}
type ThreadSpawnArgs = ThreadSpawnBaseArgs & ({
    input: CreateThreadRequest["input"];
    prompt?: never;
} | {
    input?: never;
    prompt: string;
});
interface ThreadUpdateArgs extends UpdateThreadRequest {
    threadId: string;
}
interface ThreadDeleteArgs extends DeleteThreadRequest {
    threadId: string;
}
interface ThreadSendArgs extends SendMessageRequest {
    threadId: string;
}
interface ThreadActionArgs {
    threadId: string;
}
interface ThreadStatusArgs extends ThreadActionArgs {
    signal?: AbortSignal;
}
interface ThreadPromptHistoryArgs extends PromptHistoryQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadPinOrderArgs extends ReorderPinnedThreadRequest {
    threadId: string;
}
interface ThreadQueuedMessageArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadQueuedMessageCreateArgs extends CreateQueuedMessageRequest {
    threadId: string;
}
interface ThreadQueuedMessageUpdateArgs extends ThreadQueuedMessageTargetArgs, UpdateQueuedMessageRequest {
}
interface ThreadQueuedMessageTargetArgs {
    queuedMessageId: string;
    threadId: string;
}
interface ThreadQueuedMessageSendArgs extends ThreadQueuedMessageTargetArgs, SendQueuedMessageRequest {
}
interface ThreadQueuedMessageReorderArgs extends ThreadQueuedMessageTargetArgs, ReorderQueuedMessageRequest {
}
interface ThreadQueuedMessageGroupBoundaryArgs extends SetQueuedMessageGroupBoundaryRequest {
    threadId: string;
}
interface ThreadStorageFilesArgs extends ThreadStorageFilesQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadStoragePathsArgs extends ThreadStoragePathsQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadTimelineTurnSummaryDetailsArgs extends TimelineTurnSummaryDetailsQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadTabsUpdateArgs extends UpdateThreadTabsRequest {
    threadId: string;
}
interface ThreadOpenArgs {
    threadId: string;
    split?: ThreadOpenSplit;
    file: ThreadOpenFile | null;
}
interface ThreadPaneActionArgs {
    action: ThreadPaneAction;
    threadId: string;
}
interface ThreadEventsListArgs {
    afterSeq?: string;
    limit?: string;
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadEventWaitArgs {
    afterSeq?: string;
    signal?: AbortSignal;
    threadId: string;
    type: string;
    waitMs: string;
}
interface ThreadTimelineArgs extends ThreadTimelineQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadOutputArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadInteractionListArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadInteractionTargetArgs {
    interactionId: string;
    threadId: string;
}
interface ThreadInteractionGetArgs extends ThreadInteractionTargetArgs {
    signal?: AbortSignal;
}
interface ThreadInteractionResolveArgs extends ThreadInteractionTargetArgs {
    resolution: PendingInteractionResolution;
}
interface ThreadInteractionRespondArgs extends ThreadInteractionTargetArgs {
    value: JsonValue;
}
type ThreadWaitTarget = {
    kind: "status";
    status: ThreadStatus;
} | {
    kind: "event";
    eventType: string;
};
interface ThreadWaitArgs {
    event?: string;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    status?: ThreadStatus;
    threadId: string;
    timeoutMs?: number;
}
type ThreadWaitResult = {
    event: NonNullable<ThreadEventWaitResult>;
    matched: true;
    target: Extract<ThreadWaitTarget, {
        kind: "event";
    }>;
    threadId: string;
} | {
    matched: true;
    target: Extract<ThreadWaitTarget, {
        kind: "status";
    }>;
    thread: ThreadGetResult;
    threadId: string;
};
interface ThreadInteractionsArea {
    cancel(args: ThreadInteractionTargetArgs): Promise<ThreadInteractionCancelResult>;
    get(args: ThreadInteractionGetArgs): Promise<ThreadInteractionGetResult>;
    list(args: ThreadInteractionListArgs): Promise<ThreadInteractionListResult>;
    resolve(args: ThreadInteractionResolveArgs): Promise<ThreadInteractionResolveResult>;
    respond(args: ThreadInteractionRespondArgs): Promise<ThreadInteractionRespondResult>;
}
interface ThreadEventsArea {
    list(args: ThreadEventsListArgs): Promise<ThreadEventsListResult>;
    wait(args: ThreadEventWaitArgs): Promise<ThreadEventWaitResult>;
}
interface ThreadQueuedMessagesArea {
    create(args: ThreadQueuedMessageCreateArgs): Promise<ThreadQueuedMessageCreateResult>;
    delete(args: ThreadQueuedMessageTargetArgs): Promise<ThreadQueuedMessageDeleteResult>;
    list(args: ThreadQueuedMessageArgs): Promise<ThreadQueuedMessagesResult>;
    reorder(args: ThreadQueuedMessageReorderArgs): Promise<ThreadQueuedMessageReorderResult>;
    send(args: ThreadQueuedMessageSendArgs): Promise<ThreadQueuedMessageSendResult>;
    setGroupBoundary(args: ThreadQueuedMessageGroupBoundaryArgs): Promise<ThreadQueuedMessageGroupBoundaryResult>;
    update(args: ThreadQueuedMessageUpdateArgs): Promise<ThreadQueuedMessageUpdateResult>;
}
interface ThreadTabsArea {
    get(args: ThreadStatusArgs): Promise<ThreadTabsResult>;
    update(args: ThreadTabsUpdateArgs): Promise<ThreadTabsUpdateResult>;
}
interface ThreadsArea {
    archive(args: ThreadActionArgs): Promise<ThreadArchiveResult>;
    archiveAll(args: ThreadActionArgs): Promise<ThreadArchiveAllResult>;
    childSummary(args: ThreadStatusArgs): Promise<ThreadChildSummaryResult>;
    conversationOutline(args: ThreadStatusArgs): Promise<ThreadConversationOutlineResult>;
    defaultExecutionOptions(args: ThreadStatusArgs): Promise<ThreadDefaultExecutionOptionsResult>;
    delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
    events: ThreadEventsArea;
    get(args: ThreadGetArgs): Promise<ThreadGetResult>;
    interactions: ThreadInteractionsArea;
    list(args?: ThreadListArgs): Promise<ThreadListResult>;
    markRead(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    markUnread(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
    paneAction(args: ThreadPaneActionArgs): Promise<ThreadPaneActionResult>;
    output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
    pin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    promptHistory(args: ThreadPromptHistoryArgs): Promise<ThreadPromptHistoryResult>;
    queuedMessages: ThreadQueuedMessagesArea;
    reorderPinned(args: ThreadPinOrderArgs): Promise<ThreadPinOrderResult>;
    search(args: ThreadSearchArgs): Promise<ThreadSearchResult>;
    send(args: ThreadSendArgs): Promise<ThreadSendResult>;
    spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
    stop(args: ThreadActionArgs): Promise<ThreadStopResult>;
    tabs: ThreadTabsArea;
    timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
    timelineTurnSummaryDetails(args: ThreadTimelineTurnSummaryDetailsArgs): Promise<ThreadTimelineTurnSummaryDetailsResult>;
    storageFiles(args: ThreadStorageFilesArgs): Promise<ThreadStorageFilesResult>;
    storagePaths(args: ThreadStoragePathsArgs): Promise<ThreadStoragePathsResult>;
    unarchive(args: ThreadActionArgs): Promise<ThreadUnarchiveResult>;
    unpin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    update(args: ThreadUpdateArgs): Promise<ThreadMutationResult>;
    wait(args: ThreadWaitArgs): Promise<ThreadWaitResult>;
}

type ThreadSectionCreateResult = ThreadSectionResponse;
type ThreadSectionUpdateResult = ThreadSectionMutationResponse;
type ThreadSectionDeleteResult = ThreadSectionMutationResponse;
type ThreadSectionListResult = ThreadSectionResponse[];
interface ThreadSectionListArgs {
    signal?: AbortSignal;
}
interface ThreadSectionsArea {
    create(args: CreateThreadSectionRequest): Promise<ThreadSectionCreateResult>;
    delete(args: DeleteThreadSectionRequest): Promise<ThreadSectionDeleteResult>;
    list(args?: ThreadSectionListArgs): Promise<ThreadSectionListResult>;
    update(args: UpdateThreadSectionRequest): Promise<ThreadSectionUpdateResult>;
}

interface BbSdk extends BbRealtime {
    environments: EnvironmentsArea;
    files: FilesArea;
    guide: GuideArea;
    hosts: HostsArea;
    projects: ProjectsArea;
    plugins: PluginsArea;
    providers: ProvidersArea;
    status: StatusArea;
    system: SystemArea;
    terminals: TerminalsArea;
    theme: ThemeArea;
    threadSections: ThreadSectionsArea;
    threads: ThreadsArea;
}

/**
 * The backend plugin API contract — the `bb` object handed to a plugin's
 * `server.ts` factory (`export default function plugin(bb: BbPluginApi)`).
 *
 * Types only: the implementation lives in the BB server
 * (apps/server/src/services/plugins/plugin-api.ts), which imports these
 * shapes so the contract and the implementation cannot drift. Plugin authors
 * import them type-only (`import type { BbPluginApi } from
 * "@bb/plugin-sdk"`); the import is erased when BB loads the file.
 *
 * Runtime classes stay host-side. NeedsConfigurationError in particular is
 * matched by NAME, so plugin code needs no runtime import:
 * `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`.
 */
interface PluginLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
/**
 * Declarative settings descriptors (`bb.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
type PluginSettingDescriptor = {
    type: "string";
    label: string;
    description?: string;
    /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
    secret?: true;
    default?: string;
} | {
    type: "boolean";
    label: string;
    description?: string;
    default?: boolean;
} | {
    type: "select";
    label: string;
    description?: string;
    options: string[];
    default?: string;
} | {
    type: "project";
    label: string;
    description?: string;
    default?: string;
};
type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;
type PluginSettingValue = string | boolean;
/** `default` present → non-optional value; absent → `T | undefined`. */
type PluginSettingsValues<Ds extends Record<string, PluginSettingDescriptor>> = {
    [K in keyof Ds]: Ds[K] extends {
        default: string | boolean;
    } ? PluginSettingValueOf<Ds[K]> : PluginSettingValueOf<Ds[K]> | undefined;
};
type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
    type: "boolean";
} ? boolean : string;
interface PluginSettingsHandle<Ds extends Record<string, PluginSettingDescriptor>> {
    /** Load-safe: callable inside the factory. */
    get(): Promise<PluginSettingsValues<Ds>>;
    /** Fires after values change through the settings route/CLI. */
    onChange(listener: (next: PluginSettingsValues<Ds>, prev: PluginSettingsValues<Ds>) => void): void;
}
interface PluginSettings {
    define<Ds extends Record<string, PluginSettingDescriptor>>(descriptors: Ds): PluginSettingsHandle<Ds>;
}
interface PluginKvStorage {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
}
interface PluginStorage {
    /** Namespaced JSON key-value rows in bb.db; values ≤256KB each. */
    kv: PluginKvStorage;
    /**
     * Open (or reuse the path of) the plugin's own SQLite database at
     * <dataDir>/plugins/<id>/data.db — the server's better-sqlite3, WAL mode,
     * busy_timeout 5000. Handles are host-tracked and closed on
     * dispose/reload; a closed handle throws on use.
     */
    database(): Database.Database;
    /**
     * Ordered-statement migration helper: statement index = migration id in a
     * `_bb_migrations` table; unapplied statements run in one transaction.
     * Append-only — never reorder or edit shipped statements.
     */
    migrate(db: Database.Database, statements: string[]): void;
}
/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
interface PluginThreadEventPayloads {
    /** Fired after a thread row is created. */
    "thread.created": {
        thread: ThreadResponse;
    };
    /** Fired when a thread transitions into `active`. */
    "thread.active": {
        thread: ThreadResponse;
    };
    /** Fired when a thread transitions into `idle`. `lastAssistantText` is
     * assembled the same way GET /threads/:id/output is. */
    "thread.idle": {
        thread: ThreadResponse;
        lastAssistantText: string | null;
    };
    /** Fired when a thread transitions into `error`. `error` is the latest
     * system/error event message, when one exists. */
    "thread.failed": {
        thread: ThreadResponse;
        error: string | null;
    };
    /** Fired after a thread is soft-deleted. */
    "thread.deleted": {
        thread: ThreadResponse;
    };
}
type PluginThreadEventName = keyof PluginThreadEventPayloads;
type PluginThreadEventHandler<E extends PluginThreadEventName> = (payload: PluginThreadEventPayloads[E]) => void | Promise<void>;
type PluginHttpAuthMode = "local" | "token" | "none";
type PluginHttpHandler = (context: Context) => Response | Promise<Response>;
interface PluginHttp {
    /**
     * Register an HTTP route, mounted at
     * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
     * - "local": Origin/Host must be a local BB app origin; non-GET requires
     *   content-type application/json (forces a CORS preflight).
     * - "token": requires the per-plugin token (`bb plugin token <id>`) via
     *   the x-bb-plugin-token header or ?token=.
     * - "none": no checks — only for signature-verified webhooks.
     */
    route(method: string, path: string, handler: PluginHttpHandler, opts?: {
        auth?: PluginHttpAuthMode;
    }): void;
}
interface PluginRpc {
    /**
     * Register a Standard Schema-driven rpc contract and its inferred handlers,
     * served at POST
     * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
     * host validates input before invocation and output before strict JSON
     * serialization. The response is `{ ok: true, result }` or
     * `{ ok: false, error: { code, message, issues? } }`.
     */
    register<Contract extends PluginRpcContract>(contract: Contract, handlers: PluginRpcHandlers<Contract>): void;
}
interface PluginRealtime {
    /**
     * Broadcast an ephemeral `plugin-signal` WS message
     * `{ pluginId, channel, payload }` to every connected client (V1 has no
     * per-channel subscriptions). `payload` must be JSON-serializable;
     * `undefined` is normalized to `null`. Nothing is persisted.
     */
    publish(channel: string, payload: unknown): void;
}
interface PluginBackground {
    /**
     * Register a long-lived background service. `start` runs after the
     * factory completes and should resolve when `signal` aborts
     * (dispose/reload/disable/shutdown). A crash restarts it with capped
     * exponential backoff; throwing NeedsConfigurationError marks the plugin
     * `needs-configuration` and stops restarting until the next load.
     */
    service(name: string, service: {
        start(signal: AbortSignal): void | Promise<void>;
    }): void;
    /**
     * Register a cron schedule (5-field expression, server-local time). The
     * durable row keyed (pluginId, name) is upserted at load; the periodic
     * sweep claims due rows with a CAS on next_run_at, but only while this
     * plugin is loaded. Failures land in last_status/last_error, visible in
     * `bb plugin list`.
     */
    schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}
interface PluginCliCommandInfo {
    name: string;
    summary: string;
    usage: string;
}
/** Context forwarded from the invoking CLI when known; all fields optional. */
interface PluginCliContext {
    cwd?: string;
    threadId?: string;
    projectId?: string;
    /** Aborted when the invoking CLI HTTP request disconnects. */
    signal?: AbortSignal;
}
type PluginInteractionCancelReason = "user" | "request-aborted" | "thread-stopped" | "thread-deleted" | "plugin-disposed" | "server-restarted" | "timeout";
type PluginInteractionResult = {
    outcome: "submitted";
    value: JsonValue$1;
} | {
    outcome: "cancelled";
    reason: PluginInteractionCancelReason;
};
interface PluginInteractionRequest {
    threadId: string;
    rendererId: string;
    title: string;
    payload: JsonValue$1;
    /** Defaults to ten minutes; capped at one hour. */
    timeoutMs?: number;
}
interface PluginCliResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
}
/**
 * Maximum combined UTF-8 bytes accepted from plugin CLI stdout and stderr.
 * This is the shared source of truth for production and the testing harness.
 */
declare const PLUGIN_CLI_OUTPUT_MAX_BYTES: number;
interface PluginCliOutputLimitError {
    code: "plugin_cli_output_too_large";
    message: string;
    maxBytes: number;
    stdoutBytes: number;
    stderrBytes: number;
    totalBytes: number;
}
/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
interface PluginCliExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: PluginCliOutputLimitError;
}
interface PluginCliRegistration {
    /** Top-level command name (`bb <name> …`): lowercase [a-z0-9-]+, and not
     * a core bb command (see RESERVED_BB_CLI_COMMANDS in the server). */
    name: string;
    summary: string;
    /** Subcommand metadata rendered in help and the plugin-commands skill
     * without executing plugin code. Parsing argv is plugin-owned. */
    commands?: PluginCliCommandInfo[];
    run(argv: string[], ctx: PluginCliContext): PluginCliResult | Promise<PluginCliResult>;
}
interface PluginCli {
    /**
     * Register this plugin's `bb` subcommand. One registration per factory
     * execution; a repeated call is rejected. Core bb commands always win
     * name collisions; reserved names are rejected at registration.
     */
    register(registration: PluginCliRegistration): void;
}
/** Per-turn context handed to bb.agents context providers (design §4.4). */
/** MCP-style content parts a native tool may return (design §4.4). */
type PluginAgentToolContentPart = {
    type: "text";
    text: string;
} | {
    type: "image";
    data: string;
    mimeType: string;
};
type PluginAgentToolResult = string | {
    content: PluginAgentToolContentPart[];
    isError?: boolean;
};
/** Per-call context handed to a native tool's execute (design §4.4). */
interface PluginAgentToolContext {
    threadId: string;
    projectId: string;
    /** The tool-call request's abort signal (aborts if the daemon round-trip
     * is torn down mid-call). */
    signal: AbortSignal;
}
interface PluginAgentToolRegistrationBase {
    /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
     * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES in the
     * server). */
    name: string;
    description: string;
    /**
     * Optional usage snippet appended to the thread instructions whenever
     * this tool is in the session's tool set (mirrors the built-in
     * update_environment_directory guidance). Limited to 4096 characters.
     */
    instructions?: string;
}
/** Stable, plain-data context resolved by the server for one agent session. */
interface PluginAgentConfigurationContext {
    thread: {
        id: string;
        title: string | null;
        parentThreadId: string | null;
        sourceThreadId: string | null;
    };
    project: {
        id: string;
        kind: "standard" | "personal";
        name: string;
        gitRemoteUrl: string | null;
    };
    environment: {
        id: string;
        name: string | null;
        path: string | null;
        workspaceProvisionType: "unmanaged" | "managed-worktree" | "personal";
        branchName: string | null;
    };
    host: {
        id: string;
        name: string;
    };
    provider: {
        id: string;
        model: string;
    };
    sideChat: boolean;
    origin: {
        kind: "fork" | "side-chat" | null;
        pluginId: string | null;
    };
}
/** Object form of a {@link PluginAgentConfiguration} tools entry: selects a
 * registered tool and overrides the parameter schema advertised to the
 * provider for this resolution only. */
interface PluginAgentToolSelection {
    /** Name of a tool registered by this plugin via `registerTool`. */
    name: string;
    /** JSON-schema object (root `type: "object"`, JSON-serializable, at most
     * 128 KiB serialized) sent to the provider in place of the registered
     * parameter schema. Execution-side validation still runs the registered
     * parameters, so the override must only narrow what the registered schema
     * already accepts. */
    parameters: Record<string, unknown>;
}
/** Per-resolution selection returned by {@link PluginAgents.configure}. */
interface PluginAgentConfiguration {
    /** Tool names registered by this plugin, or {@link PluginAgentToolSelection}
     * entries to also override a tool's advertised parameter schema for this
     * resolution. Duplicate or unknown names, or an invalid override, reject
     * this plugin's complete selection for the resolution. */
    tools: Array<string | PluginAgentToolSelection>;
    /** Skill frontmatter names from this plugin's manifest skill roots.
     * Duplicate or unknown names reject this plugin's complete selection. */
    skills: string[];
    /** Optional dynamic instructions. Output is truncated to 4096 characters. */
    instructions?: string;
}
interface PluginAgents {
    /**
     * Select this plugin's statically registered tools and manifest skills for
     * each thread/session resolution, with optional dynamic instructions. The
     * callback is synchronous and runs at `thread.start` / `turn.submit`; it
     * never rebuilds registrations. Exactly one callback may be registered per
     * factory execution. A throw, malformed result, duplicate id, unknown id,
     * or more than 256 tool/skill ids fails closed for this plugin only.
     *
     * Tools take effect when the provider session is next started or resumed;
     * an already-running session is not hot-mutated. Instructions are resolved
     * for the next turn. Skill changes follow BB's environment runtime policy:
     * a busy runtime keeps its current catalog until a safe relaunch. Side-chat
     * threads receive `sideChat: true`, and their returned tool, skill, and
     * dynamic-instruction selections apply at the same boundaries. Independent
     * side-chat safety policy (such as permission escalation) is unchanged.
     */
    configure(provider: (context: PluginAgentConfigurationContext) => PluginAgentConfiguration): void;
    /**
     * Register a native dynamic tool (design §4.4). `parameters` is either a
     * zod schema (validated per call; execute receives the parsed value) or a
     * plain JSON-schema object (no validation; execute receives the raw
     * arguments as `unknown`). Tool-set changes apply on the NEXT session
     * start — a tool registered mid-session is not hot-added to running
     * provider sessions. A second registration of the same name within this
     * plugin is rejected; a name already registered by another plugin is
     * rejected and surfaced as this plugin's status detail.
     */
    registerTool<Schema extends z.ZodType>(tool: PluginAgentToolRegistrationBase & {
        parameters: Schema;
        execute(params: z.output<Schema>, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }): void;
    registerTool(tool: PluginAgentToolRegistrationBase & {
        /** Raw JSON-schema escape hatch; params arrive unvalidated. */
        parameters: Record<string, unknown>;
        execute(params: unknown, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }): void;
    /**
     * Contribute a dynamic section appended to thread instructions. The
     * provider runs when a thread's runtime command config is resolved
     * (thread.start / turn.submit); return null to contribute nothing for
     * that resolution. Must be synchronous and fast — it sits on the
     * thread-start path. Output longer than 4096 characters is truncated; a
     * throwing provider is logged against the plugin and contributes nothing.
     * A repeated registration within one factory execution is rejected.
     * This legacy contribution is not applied to side-chat threads; use
     * configure() when sideChat-aware dynamic instructions are required.
     */
    contributeInstructions(provider: (ctx: {
        threadId: string;
        projectId: string;
    }) => string | null): void;
}
interface PluginThreadActionContext {
    threadId: string;
    projectId: string;
}
interface PluginThreadActionToast {
    kind: "success" | "error" | "info";
    message: string;
}
type PluginThreadActionResult = void | {
    toast?: PluginThreadActionToast;
};
interface PluginThreadActionRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+ (becomes a URL segment). */
    id: string;
    /** Button label rendered in the thread header. */
    title: string;
    /** Optional icon name; the host falls back to a generic icon. */
    icon?: string;
    /** Optional confirmation prompt the host shows before running. */
    confirm?: string;
    /**
     * Runs server-side when the user clicks the action. The host shows a
     * pending state while in flight, the returned toast on completion, and an
     * automatic error toast when this throws.
     */
    run(ctx: PluginThreadActionContext): PluginThreadActionResult | Promise<PluginThreadActionResult>;
}
type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";
/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
interface PluginMentionSearchContext {
    trigger: PluginMentionTrigger;
    query: string;
    projectId: string | null;
    threadId: string | null;
}
/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
interface PluginMentionItem {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
}
interface PluginMentionProviderRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
     * wire item ids as "<providerId>:<itemId>"). */
    id: string;
    /** Section label shown above this provider's rows in the mention menu. */
    label: string;
    /**
     * Composer trigger characters this provider should answer. Omit to use the
     * default `@` mention trigger. Valid triggers are `@`, `#`, `$`, `!`, and `~`.
     */
    triggers?: readonly PluginMentionTrigger[];
    /**
     * Runs server-side as the user types after one of this provider's triggers
     * in the composer. Each call is time-boxed (2s) and failure-isolated: a slow
     * or throwing provider contributes an empty list — it can never break the
     * mention menu.
     */
    search(ctx: PluginMentionSearchContext): PluginMentionItem[] | Promise<PluginMentionItem[]>;
    /**
     * Resolves one picked item into agent context, called once per unique
     * item at message send time. The returned `context` is attached to the
     * message as an agent-visible (user-hidden) prompt input. Throwing blocks
     * the send with a visible error.
     */
    resolve(itemId: string): {
        context: string;
    } | Promise<{
        context: string;
    }>;
}
interface PluginUi {
    /** Block until the app submits or cancels a plugin-owned composer form. */
    requestInput(request: PluginInteractionRequest, options?: {
        signal?: AbortSignal;
    }): Promise<PluginInteractionResult>;
    /**
     * Register a thread action rendered in the shipped app's thread header
     * (design §4.9). Multiple actions per plugin; ids must be unique within
     * the plugin. Invoked via POST /plugins/:id/actions/:actionId.
     */
    registerThreadAction(action: PluginThreadActionRegistration): void;
    /**
     * Register a mention provider for the shipped app's composer (design §4.9).
     * Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or
     * `~` with `triggers`. Items group under `label` in the mention menu; a
     * picked item becomes a `{ kind: "plugin" }` mention resource whose context
     * is resolved once at send time. Multiple providers per plugin; ids must be
     * unique within the plugin.
     */
    registerMentionProvider(provider: PluginMentionProviderRegistration): void;
}
interface PluginEvents {
    /**
     * Add a thread lifecycle listener. Multiple listeners for the same event are
     * additive and run independently in registration order.
     */
    on<E extends PluginThreadEventName>(event: E, handler: PluginThreadEventHandler<E>): void;
}
interface PluginServerApi {
    /**
     * This BB server's own loopback base URL (e.g. "http://127.0.0.1:38886"),
     * which serves the SPA + /api + /ws. For plugins that proxy or relay
     * traffic back to the server itself (e.g. a tunnel). Bind-gated like
     * `bb.sdk`: reading it before the server is listening throws, so prefer
     * reading it from handlers, services, and timers.
     */
    readonly loopbackBaseUrl: string;
}
interface PluginSharedPortTunnelIdentity {
    /** Gate routing label assigned to this machine. */
    label: string;
    /** Gate apex without a scheme, e.g. "getbb.app". */
    baseDomain: string;
}
interface PluginHosts {
    /**
     * Ensure this enrolled host has a gate label and return its read-only public
     * identity. The daemon chooses the trusted gate and desired label; plugins
     * cannot influence either credential-bearing destination.
     */
    ensureSharedPortTunnel(hostId: string): Promise<PluginSharedPortTunnelIdentity>;
    /**
     * Replace this plugin's desired shared-loopback ports for one host. The
     * server aggregates declarations, owns generations, and delivers the
     * resulting set to that host's daemon. Tunnel identity is deliberately not
     * accepted here: it is owned by the daemon's trusted enrollment.
     */
    declareSharedPorts(hostId: string, ports: readonly number[]): void;
}
interface PluginStatusApi {
    /**
     * Mark this plugin `needs-configuration` (with a message shown in
     * `bb plugin list` and the UI) instead of failing — e.g. a factory or
     * service that finds no API key configured. Cleared on the next load;
     * saving settings does not auto-reload in V1, so ask the user to
     * `bb plugin reload <id>` after configuring.
     */
    needsConfiguration(message: string): void;
}
/**
 * The API object handed to a plugin's factory (design §4). Implemented by
 * the BB server; this contract is what plugin `server.ts` files compile
 * against.
 */
interface BbPluginApi {
    /** The plugin's own id (namespaces storage, routes, commands). */
    readonly pluginId: string;
    /** Leveled, plugin-scoped logger. */
    readonly log: PluginLogger;
    /** Declarative settings (design §4.2). */
    readonly settings: PluginSettings;
    /** Namespaced KV + per-plugin database (design §4.3). */
    readonly storage: PluginStorage;
    /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
    readonly http: PluginHttp;
    /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
    readonly rpc: PluginRpc;
    /** Ephemeral push to connected frontends (design §4.7). */
    readonly realtime: PluginRealtime;
    /** Long-lived services + cron schedules (design §4.8). */
    readonly background: PluginBackground;
    /** Agent-facing `bb` CLI subcommand (design §4.4). */
    readonly cli: PluginCli;
    /** Per-turn agent context contributions (design §4.4). */
    readonly agents: PluginAgents;
    /** Host-rendered UI contributions (design §4.9). */
    readonly ui: PluginUi;
    /** Additive plugin lifecycle listeners (design §4.5). */
    readonly events: PluginEvents;
    /** Plugin-reported status (needs-configuration). */
    readonly status: PluginStatusApi;
    /** Read-only facts about the running server (loopback base URL). */
    readonly server: PluginServerApi;
    /** Server-to-daemon host control-plane declarations. */
    readonly hosts: PluginHosts;
    /**
     * The full BB SDK, bound to this server over loopback (design §4.1).
     * Bind-gated: reading this before the host binds the SDK throws. The real
     * server binds it before loading plugins, so it is available from the
     * moment factories run there — but isolated harnesses may not, so prefer
     * using it from handlers, services, and timers for portability.
     * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
     * this plugin's id so spawned threads are attributed automatically.
     */
    readonly sdk: BbSdk;
    /**
     * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
     * The sanctioned place to clear timers and close connections.
     */
    onDispose(hook: () => void | Promise<void>): void;
}

export { PLUGIN_CLI_OUTPUT_MAX_BYTES, defineRpcContract };
export type { BbContext, BbNavigate, BbPluginApi, JsonValue$1 as JsonValue, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolContentPart, PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult, PluginAgentToolSelection, PluginAgents, PluginAppBuilder, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginBackground, PluginCli, PluginCliCommandInfo, PluginCliContext, PluginCliExecutionResult, PluginCliOutputLimitError, PluginCliRegistration, PluginCliResult, PluginComposerAccessoryProps, PluginComposerAccessoryRegistration, PluginComposerApi, PluginComposerMention, PluginComposerScope, PluginEvents, PluginFileOpenerProps, PluginFileOpenerRegistration, PluginFileOpenerSource, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginHosts, PluginHttp, PluginHttpAuthMode, PluginHttpHandler, PluginInteractionCancelReason, PluginInteractionRequest, PluginInteractionResult, PluginKvStorage, PluginLogger, PluginMentionItem, PluginMentionProviderRegistration, PluginMentionSearchContext, PluginMentionTrigger, PluginMessageDirectiveMessage, PluginMessageDirectiveOpenThreadPanel, PluginMessageDirectiveOpenWorkspaceFile, PluginMessageDirectiveProps, PluginMessageDirectiveRegistration, PluginMessageDirectiveThreadPanelOptions, PluginNavPanelProps, PluginNavPanelRegistration, PluginPendingInteractionProps, PluginPendingInteractionRegistration, PluginPendingInteractionView, PluginRealtime, PluginRealtimeConnectionState, PluginRpc, PluginRpcCallArgs, PluginRpcClient, PluginRpcContract, PluginRpcError, PluginRpcErrorCode, PluginRpcHandlers, PluginRpcIssuePathSegment, PluginRpcMethodContract, PluginRpcResult, PluginRpcValidationIssue, PluginSdkApp, PluginServerApi, PluginSettingDescriptor, PluginSettingDescriptors, PluginSettingValue, PluginSettings, PluginSettingsHandle, PluginSettingsSectionProps, PluginSettingsSectionRegistration, PluginSettingsState, PluginSettingsValues, PluginSharedPortTunnelIdentity, PluginSidebarFooterActionContext, PluginSidebarFooterActionProps, PluginSidebarFooterActionRegistration, PluginStatusApi, PluginStorage, PluginThreadActionContext, PluginThreadActionRegistration, PluginThreadActionResult, PluginThreadActionToast, PluginThreadEventHandler, PluginThreadEventName, PluginThreadEventPayloads, PluginThreadPanelActionContext, PluginThreadPanelActionRegistration, PluginThreadPanelProps, PluginUi, StandardSchemaV1, StandardSchemaV1InferInput, StandardSchemaV1InferOutput, StandardSchemaV1Issue, StandardSchemaV1Result };
