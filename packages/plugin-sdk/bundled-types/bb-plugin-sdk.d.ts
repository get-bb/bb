// Bundled type declarations for `@bb/plugin-sdk`, shipped into scaffolded
// plugins so they typecheck without the @bb/* workspace on disk.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/ymichael/bb

import { ComponentType } from 'react';
import Database from 'better-sqlite3';
import { Context } from 'hono';
import * as z from 'zod';
import { z as z$1 } from 'zod';

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
    params: unknown;
}
/** Props passed to a `composerAccessory` component. */
interface PluginComposerAccessoryProps {
    projectId: string | null;
    threadId: string | null;
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
interface PluginAppSlots {
    homepageSection(registration: PluginHomepageSectionRegistration): void;
    navPanel(registration: PluginNavPanelRegistration): void;
    threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
    composerAccessory(registration: PluginComposerAccessoryRegistration): void;
    fileOpener(registration: PluginFileOpenerRegistration): void;
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
    useComposer(): PluginComposerApi;
}
/**
 * Named runtime exports of `@bb/plugin-sdk/app`, in sorted order. Single
 * source of truth for the build shim's export list and the app's
 * implementation-key test — adding a surface member without updating this
 * list fails the type assertion below.
 */
declare const PLUGIN_SDK_APP_EXPORT_NAMES: readonly ["definePluginApp", "useBbContext", "useBbNavigate", "useComposer", "useRealtime", "useRpc", "useSettings"];

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

declare const changedMessageSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"thread">;
    id: z$1.ZodOptional<z$1.ZodString>;
    metadata: z$1.ZodOptional<z$1.ZodObject<{
        backgroundActivityChanged: z$1.ZodOptional<z$1.ZodBoolean>;
        eventTypes: z$1.ZodOptional<z$1.ZodReadonly<z$1.ZodArray<z$1.ZodString & z$1.ZodType<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/warning" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string, z$1.core.$ZodTypeInternals<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/warning" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string>>>>>;
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
        "automations-changed": "automations-changed";
        "automation-runs-changed": "automation-runs-changed";
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
        "ui-reloaded": "ui-reloaded";
        "ui-status-changed": "ui-status-changed";
    }>>>;
}, z$1.core.$strict>], "entity">;
type ChangedMessage = z$1.infer<typeof changedMessageSchema>;

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
}, z$1.core.$strip>]>;
type PendingInteractionResolution = z$1.infer<typeof pendingInteractionResolutionSchema>;

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
            pending: "pending";
            in_progress: "in_progress";
            completed: "completed";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThreadTimelinePendingTodos = z$1.infer<typeof threadTimelinePendingTodosSchema>;

declare const createAutomationRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
    enabled: z$1.ZodDefault<z$1.ZodBoolean>;
    trigger: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        triggerType: z$1.ZodLiteral<"schedule">;
        cron: z$1.ZodString;
        timezone: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        triggerType: z$1.ZodLiteral<"once">;
        runAt: z$1.ZodNumber;
    }, z$1.core.$strip>], "triggerType">;
    execution: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mode: z$1.ZodLiteral<"agent">;
        prompt: z$1.ZodString;
        providerId: z$1.ZodString;
        model: z$1.ZodString;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            "workspace-write": "workspace-write";
        }>;
        targetThreadId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mode: z$1.ZodLiteral<"script">;
        script: z$1.ZodOptional<z$1.ZodString>;
        scriptFile: z$1.ZodOptional<z$1.ZodString>;
        interpreter: z$1.ZodOptional<z$1.ZodEnum<{
            bash: "bash";
            sh: "sh";
            node: "node";
            python3: "python3";
        }>>;
        timeoutMs: z$1.ZodDefault<z$1.ZodNumber>;
        env: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodString>>;
    }, z$1.core.$strip>], "mode">;
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
    }, z$1.core.$strip>], "type">;
    autoArchive: z$1.ZodDefault<z$1.ZodBoolean>;
    origin: z$1.ZodEnum<{
        agent: "agent";
        human: "human";
        app: "app";
    }>;
    createdByThreadId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type CreateAutomationRequest = z$1.input<typeof createAutomationRequestSchema>;
declare const updateAutomationRequestSchema: z$1.ZodObject<{
    name: z$1.ZodOptional<z$1.ZodString>;
    trigger: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        triggerType: z$1.ZodLiteral<"schedule">;
        cron: z$1.ZodString;
        timezone: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        triggerType: z$1.ZodLiteral<"once">;
        runAt: z$1.ZodNumber;
    }, z$1.core.$strip>], "triggerType">>;
    execution: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mode: z$1.ZodLiteral<"agent">;
        prompt: z$1.ZodString;
        providerId: z$1.ZodString;
        model: z$1.ZodString;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            "workspace-write": "workspace-write";
        }>;
        targetThreadId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        mode: z$1.ZodLiteral<"script">;
        script: z$1.ZodOptional<z$1.ZodString>;
        scriptFile: z$1.ZodOptional<z$1.ZodString>;
        interpreter: z$1.ZodOptional<z$1.ZodEnum<{
            bash: "bash";
            sh: "sh";
            node: "node";
            python3: "python3";
        }>>;
        timeoutMs: z$1.ZodDefault<z$1.ZodNumber>;
        env: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodString>>;
    }, z$1.core.$strip>], "mode">>;
    environment: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
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
    }, z$1.core.$strip>], "type">>;
    autoArchive: z$1.ZodOptional<z$1.ZodBoolean>;
}, z$1.core.$strict>;
type UpdateAutomationRequest = z$1.infer<typeof updateAutomationRequestSchema>;
declare const runAutomationRequestSchema: z$1.ZodObject<{
    idempotencyKey: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type RunAutomationRequest = z$1.infer<typeof runAutomationRequestSchema>;

/**
 * `POST /connect/pair` — redeem a one-time connect code so this server is
 * reachable at `<handle>.<domain>` through the connect tunnel. The server
 * holds the tunnel from then on (across restarts); the CLI/app just pair.
 * `baseUrl` (the connect cloud apex, e.g. https://getbb.app) is derived from
 * `serverUrl` when omitted.
 */
declare const connectPairRequestSchema: z$1.ZodObject<{
    code: z$1.ZodString;
    serverUrl: z$1.ZodString;
    baseUrl: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type ConnectPairRequest = z$1.infer<typeof connectPairRequestSchema>;

declare const createProjectSourceRequestSchema: z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"local_path">;
    path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
}, z$1.core.$strict>;
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
declare const projectListQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectListQuery = z$1.infer<typeof projectListQuerySchema>;
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

declare const updateEnvironmentRequestSchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    name: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
}, z$1.core.$strip>;
type UpdateEnvironmentRequest = z$1.infer<typeof updateEnvironmentRequestSchema>;
declare const environmentDiffBranchesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesQuery = z$1.infer<typeof environmentDiffBranchesQuerySchema>;
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
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"branch_committed">;
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"all">;
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"commit">;
    sha: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffFileQuery = z$1.infer<typeof environmentDiffFileQuerySchema>;

declare const systemExecutionOptionsQuerySchema: z$1.ZodObject<{
    providerId: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemExecutionOptionsQuery = z$1.infer<typeof systemExecutionOptionsQuerySchema>;
/**
 * Theme catalog: the on-disk custom-theme directory plus the discovered custom
 * themes and the active palette. Drives `bb theme list` / `bb theme dir`.
 */
declare const themeCatalogResponseSchema: z$1.ZodObject<{
    dir: z$1.ZodString;
    custom: z$1.ZodArray<z$1.ZodString>;
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
declare const closeTerminalRequestSchema: z$1.ZodObject<{
    mode: z$1.ZodEnum<{
        force: "force";
        "if-clean": "if-clean";
    }>;
    reason: z$1.ZodLiteral<"user">;
}, z$1.core.$strict>;
type CloseTerminalRequest = z$1.infer<typeof closeTerminalRequestSchema>;
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

declare const createThreadRequestSchema: z$1.ZodObject<{
    projectId: z$1.ZodString;
    providerId: z$1.ZodOptional<z$1.ZodString>;
    origin: z$1.ZodEnum<{
        plugin: "plugin";
        app: "app";
        automation: "automation";
        cli: "cli";
        sdk: "sdk";
    }>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
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
            resource: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
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
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">;
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
    folderId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
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
        fork: "fork";
        "side-chat": "side-chat";
    }>>>;
    childOrigin: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
        "side-chat": "side-chat";
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
            resource: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
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
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">;
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
declare const threadResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    folderId: z$1.ZodNullable<z$1.ZodString>;
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
        fork: "fork";
        "side-chat": "side-chat";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
        "side-chat": "side-chat";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
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
declare const deleteThreadRequestSchema: z$1.ZodObject<{
    childThreadsConfirmed: z$1.ZodBoolean;
}, z$1.core.$strip>;
type DeleteThreadRequest = z$1.infer<typeof deleteThreadRequestSchema>;
declare const updateThreadRequestSchema: z$1.ZodObject<{
    title: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    folderId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
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
    }>>>;
}, z$1.core.$strip>;
type UpdateThreadRequest = z$1.infer<typeof updateThreadRequestSchema>;
/** Which root a secondary-panel file path is relative to. */
declare const panelFileSourceSchema: z$1.ZodEnum<{
    workspace: "workspace";
    "thread-storage": "thread-storage";
}>;
type PanelFileSource = z$1.infer<typeof panelFileSourceSchema>;
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

type PublicApiSchema = unknown;
type ApiClient = unknown;

type FetchImplementation = typeof fetch;
type JsonBodyOf<TResponse> = TResponse extends {
    json(): Promise<infer TBody>;
} ? TBody : never;

type BbSdkRuntime = "node" | "browser";
interface BbSdkTransport {
    api: ApiClient["api"];
    baseUrl: string;
    fetch: FetchImplementation;
    realtimeUrl?: string;
    runtime: BbSdkRuntime;
    readJson<TResponse extends Response>(response: Promise<TResponse>): Promise<JsonBodyOf<TResponse>>;
    readVoid<TResponse extends Response>(response: Promise<TResponse>): Promise<void>;
    resolve<TResponse extends Response>(response: Promise<TResponse>): Promise<TResponse>;
    websocket?: BbRealtimeSocketFactory;
}
/**
 * Raw socket payload. Treated as opaque until decoded — realtime ignores
 * non-string frames.
 */
interface BbRealtimeSocketMessageEvent {
    data: unknown;
}
/**
 * Minimal runtime-agnostic socket shape consumed by the realtime client.
 * Default factories adapt the environment's WebSocket (browser/Node global,
 * or the `ws` package on older Node) to this interface; custom `websocket`
 * factories can wrap any implementation the same way.
 */
interface BbRealtimeSocket {
    close(): void;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    onmessage: ((event: BbRealtimeSocketMessageEvent) => void) | null;
    onopen: (() => void) | null;
    readyState: number;
    send(data: string): void;
}
type BbRealtimeSocketFactory = (url: string) => BbRealtimeSocket;
interface BbSdkContext {
}

interface CreateSdkAreaArgs {
    context: BbSdkContext;
    transport: BbSdkTransport;
}
type PublicApiEndpointOutput<TEndpoint> = TEndpoint extends {
    status: infer Status;
    output: infer Output;
} ? Status extends SuccessfulHttpStatus ? Output : never : never;
type SuccessfulHttpStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
type PublicApiOutput<TPath extends keyof PublicApiSchema, TMethod extends keyof PublicApiSchema[TPath]> = PublicApiEndpointOutput<PublicApiSchema[TPath][TMethod]>;

interface AutomationCreateArgs extends CreateAutomationRequest {
    projectId?: string;
}
interface AutomationListArgs {
    projectId?: string;
}
interface AutomationGetArgs {
    projectId?: string;
    automationId: string;
}
interface AutomationUpdateArgs extends UpdateAutomationRequest {
    projectId?: string;
    automationId: string;
}
interface AutomationActionArgs {
    projectId?: string;
    automationId: string;
}
interface AutomationRunArgs extends RunAutomationRequest {
    projectId?: string;
    automationId: string;
}
interface AutomationRunsArgs {
    projectId?: string;
    automationId: string;
    limit?: number;
    cursor?: string;
}
type AutomationCreateResult = PublicApiOutput<"/projects/:id/automations", "$post">;
type AutomationListResult = PublicApiOutput<"/projects/:id/automations", "$get">;
type AutomationGetResult = PublicApiOutput<"/projects/:id/automations/:automationId", "$get">;
type AutomationUpdateResult = PublicApiOutput<"/projects/:id/automations/:automationId", "$patch">;
type AutomationPauseResult = PublicApiOutput<"/projects/:id/automations/:automationId/pause", "$post">;
type AutomationResumeResult = PublicApiOutput<"/projects/:id/automations/:automationId/resume", "$post">;
type AutomationRunResult = PublicApiOutput<"/projects/:id/automations/:automationId/run", "$post">;
type AutomationRunsResult = PublicApiOutput<"/projects/:id/automations/:automationId/runs", "$get">;
type AutomationsOverviewResult = PublicApiOutput<"/automations", "$get">;
interface AutomationsArea {
    create(args: AutomationCreateArgs): Promise<AutomationCreateResult>;
    delete(args: AutomationActionArgs): Promise<{
        ok: true;
    }>;
    get(args: AutomationGetArgs): Promise<AutomationGetResult>;
    list(args?: AutomationListArgs): Promise<AutomationListResult>;
    overview(): Promise<AutomationsOverviewResult>;
    pause(args: AutomationActionArgs): Promise<AutomationPauseResult>;
    resume(args: AutomationActionArgs): Promise<AutomationResumeResult>;
    run(args: AutomationRunArgs): Promise<AutomationRunResult>;
    runs(args: AutomationRunsArgs): Promise<AutomationRunsResult>;
    update(args: AutomationUpdateArgs): Promise<AutomationUpdateResult>;
}
declare function createAutomationsArea(args: CreateSdkAreaArgs): AutomationsArea;

interface ConnectPairArgs extends ConnectPairRequest {
}
type ConnectStatusResult = PublicApiOutput<"/connect/status", "$get">;
interface ConnectArea {
    pair(args: ConnectPairArgs): Promise<ConnectStatusResult>;
    status(): Promise<ConnectStatusResult>;
    disconnect(): Promise<ConnectStatusResult>;
}
declare function createConnectArea(args: CreateSdkAreaArgs): ConnectArea;

interface EnvironmentGetArgs {
    environmentId: string;
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
}
type EnvironmentDiffArgs = EnvironmentDiffQuery & {
    environmentId: string;
};
type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
    environmentId: string;
};
interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
    environmentId: string;
}
interface EnvironmentCommitArgs {
    environmentId: string;
}
interface EnvironmentSquashMergeArgs {
    environmentId: string;
    mergeBaseBranch: string;
}
type EnvironmentActionResult = PublicApiOutput<"/environments/:id/actions", "$post">;
type EnvironmentCommitResult = Extract<EnvironmentActionResult, {
    action: "commit";
}>;
type EnvironmentDiffResult = PublicApiOutput<"/environments/:id/diff", "$get">;
type EnvironmentDiffBranchesResult = PublicApiOutput<"/environments/:id/diff/branches", "$get">;
type EnvironmentDiffFileResult = PublicApiOutput<"/environments/:id/diff/file", "$get">;
type EnvironmentGetResult = PublicApiOutput<"/environments/:id", "$get">;
type EnvironmentPullRequestResult = PublicApiOutput<"/environments/:id/pull-request", "$get">;
type EnvironmentSquashMergeResult = Extract<EnvironmentActionResult, {
    action: "squash_merge";
}>;
type EnvironmentStatusResult = PublicApiOutput<"/environments/:id/status", "$get">;
type EnvironmentUpdateResult = PublicApiOutput<"/environments/:id", "$patch">;
interface EnvironmentsArea {
    commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
    diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
    diffBranches(args: EnvironmentDiffBranchesArgs): Promise<EnvironmentDiffBranchesResult>;
    diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
    get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
    pullRequest(args: EnvironmentGetArgs): Promise<EnvironmentPullRequestResult>;
    squashMerge(args: EnvironmentSquashMergeArgs): Promise<EnvironmentSquashMergeResult>;
    status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
    update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}
declare function createEnvironmentsArea(args: CreateSdkAreaArgs): EnvironmentsArea;

/**
 * Host file primitives. `hostId` may be omitted to target the server's
 * primary (local) host. `rootPath`, when set, confines the target beneath
 * that absolute root on the host (symlink-safe).
 */
interface FileReadArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
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
}
interface FileListArgs {
    hostId?: string;
    path: string;
    query?: string;
    limit?: number;
}
type FileReadResult = PublicApiOutput<"/files/read", "$post">;
type FileWriteResult = PublicApiOutput<"/files/write", "$post">;
type FileListResult = PublicApiOutput<"/files/list", "$post">;
interface FilesArea {
    read(args: FileReadArgs): Promise<FileReadResult>;
    write(args: FileWriteArgs): Promise<FileWriteResult>;
    list(args: FileListArgs): Promise<FileListResult>;
}
declare function createFilesArea(args: CreateSdkAreaArgs): FilesArea;

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
declare function createGuideArea(): GuideArea;

interface HostGetArgs {
    hostId: string;
}
type HostGetResult = PublicApiOutput<"/hosts/:id", "$get">;
type HostListResult = PublicApiOutput<"/hosts", "$get">;
interface HostsArea {
    get(args: HostGetArgs): Promise<HostGetResult>;
    list(): Promise<HostListResult>;
}
declare function createHostsArea(args: CreateSdkAreaArgs): HostsArea;

interface ProjectListArgs extends ProjectListQuery {
}
interface ProjectCreateArgs extends CreateProjectRequest {
}
interface ProjectGetArgs {
    projectId: string;
}
interface ProjectUpdateArgs extends UpdateProjectRequest {
    projectId: string;
}
interface ProjectDeleteArgs {
    projectId: string;
}
interface ProjectSourceAddArgs extends CreateProjectSourceRequest {
    projectId: string;
}
interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
    projectId: string;
    sourceId: string;
}
interface ProjectSourceDeleteArgs {
    projectId: string;
    sourceId: string;
}
type ProjectCreateResult = PublicApiOutput<"/projects", "$post">;
type ProjectDeleteResult = PublicApiOutput<"/projects/:id", "$delete">;
type ProjectGetResult = PublicApiOutput<"/projects/:id", "$get">;
type ProjectListResult = PublicApiOutput<"/projects", "$get">;
type ProjectUpdateResult = PublicApiOutput<"/projects/:id", "$patch">;
type ProjectSourceAddResult = PublicApiOutput<"/projects/:id/sources", "$post">;
type ProjectSourceUpdateResult = PublicApiOutput<"/projects/:id/sources/:sourceId", "$patch">;
type ProjectSourceDeleteResult = PublicApiOutput<"/projects/:id/sources/:sourceId", "$delete">;
interface ProjectSourcesArea {
    add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
    delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
    update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}
interface ProjectsArea {
    create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
    delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
    get(args: ProjectGetArgs): Promise<ProjectGetResult>;
    list(args?: ProjectListArgs): Promise<ProjectListResult>;
    sources: ProjectSourcesArea;
    update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}
declare function createProjectsArea(args: CreateSdkAreaArgs): ProjectsArea;

interface ProviderModelsArgs extends SystemExecutionOptionsQuery {
}
type ProviderListResult = PublicApiOutput<"/system/providers", "$get">;
type ProviderModelsResult = PublicApiOutput<"/system/execution-options", "$get">;
interface ProvidersArea {
    list(): Promise<ProviderListResult>;
    models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}
declare function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea;

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
interface ThreadRealtimeOnArgs {
    callback: BbRealtimeCallback<"thread:changed">;
    event: "thread:changed";
    threadId?: string;
}
interface ProjectRealtimeOnArgs {
    callback: BbRealtimeCallback<"project:changed">;
    event: "project:changed";
    projectId?: string;
}
interface EnvironmentRealtimeOnArgs {
    callback: BbRealtimeCallback<"environment:changed">;
    environmentId?: string;
    event: "environment:changed";
}
interface HostRealtimeOnArgs {
    callback: BbRealtimeCallback<"host:changed">;
    event: "host:changed";
    hostId?: string;
}
interface SystemRealtimeOnArgs {
    callback: BbRealtimeCallback<"system:changed">;
    event: "system:changed";
}
interface SystemConfigRealtimeOnArgs {
    callback: BbRealtimeCallback<"system:config-changed">;
    event: "system:config-changed";
}
/**
 * Connection listeners are pure observers — they never open or hold the
 * socket. A listener registered while a socket already exists receives the
 * latest connection event as a snapshot on the next microtask, so a status
 * UI mounted after connect still learns the current state.
 */
interface RealtimeConnectionOnArgs {
    callback: BbRealtimeCallback<"realtime:connection">;
    event: "realtime:connection";
}
type BbRealtimeOnArgsUnion = ThreadRealtimeOnArgs | ProjectRealtimeOnArgs | EnvironmentRealtimeOnArgs | HostRealtimeOnArgs | SystemRealtimeOnArgs | SystemConfigRealtimeOnArgs | RealtimeConnectionOnArgs;
type BbRealtimeOnArgs<TEventName extends BbRealtimeEventName = BbRealtimeEventName> = Extract<BbRealtimeOnArgsUnion, {
    event: TEventName;
}>;
interface BbRealtime {
    on<TEventName extends BbRealtimeEventName>(args: BbRealtimeOnArgs<TEventName>): BbRealtimeUnsubscribe;
}

interface StatusGetArgs {
    projectId?: string;
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
type StatusProject = PublicApiOutput<"/projects/:id", "$get">;
type StatusChildThreads = PublicApiOutput<"/threads", "$get">;
interface StatusResult {
    childThreads: StatusChildThreads | null;
    pendingTodos: ThreadTimelinePendingTodos | null;
    project: StatusProject | null;
    thread: StatusThreadSummary | null;
}
interface StatusArea {
    get(args?: StatusGetArgs): Promise<StatusResult>;
}
declare function createStatusArea(args: CreateSdkAreaArgs): StatusArea;

interface ThemeArea {
    /** The active app palette, resolved server-side (built-in id or custom CSS). */
    get(): Promise<AppTheme>;
    /** The custom-theme directory plus discovered themes and the active palette. */
    catalog(): Promise<ThemeCatalogResponse>;
    /**
     * Activate a palette by id — a built-in id or a custom theme name that exists
     * under `<data-dir>/theme/<name>/theme.css`. Broadcasts to all open windows.
     */
    set(themeId: string): Promise<AppTheme>;
}
declare function createThemeArea(args: CreateSdkAreaArgs): ThemeArea;

interface ThreadListArgs {
    archived?: boolean;
    hasParent?: boolean;
    parentThreadId?: string;
    projectId?: string;
}
interface ThreadGetArgs {
    include?: ThreadGetQuery["include"];
    threadId: string;
}
type ThreadGetResult = PublicApiOutput<"/threads/:id", "$get">;
type ThreadListResult = PublicApiOutput<"/threads", "$get">;
type ThreadOutputResponse = PublicApiOutput<"/threads/:id/output", "$get">;
type ThreadMutationResult = PublicApiOutput<"/threads/:id", "$patch">;
type ThreadSpawnResult = PublicApiOutput<"/threads", "$post">;
type ThreadInteractionGetResult = PublicApiOutput<"/threads/:id/interactions/:interactionId", "$get">;
type ThreadInteractionListResult = PublicApiOutput<"/threads/:id/interactions", "$get">;
type ThreadInteractionResolveResult = PublicApiOutput<"/threads/:id/interactions/:interactionId/resolve", "$post">;
type ThreadEventsListResult = PublicApiOutput<"/threads/:id/events", "$get">;
type ThreadEventWaitResult = PublicApiOutput<"/threads/:id/events/wait", "$get">;
type ThreadTimelineResult = PublicApiOutput<"/threads/:id/timeline", "$get">;
type ThreadArchiveResult = PublicApiOutput<"/threads/:id/archive", "$post">;
type ThreadOpenResult = PublicApiOutput<"/threads/:id/open", "$post">;
type ThreadDeleteResult = PublicApiOutput<"/threads/:id", "$delete">;
type ThreadSendResult = PublicApiOutput<"/threads/:id/send", "$post">;
type ThreadStopResult = PublicApiOutput<"/threads/:id/stop", "$post">;
type ThreadTerminalCloseResult = PublicApiOutput<"/terminals/:terminalId/close", "$post">;
type ThreadTerminalCreateResult = PublicApiOutput<"/terminals", "$post">;
type ThreadTerminalInputResult = PublicApiOutput<"/terminals/:terminalId/input", "$post">;
type ThreadTerminalListResult = PublicApiOutput<"/terminals", "$get">;
type ThreadTerminalOutputResult = PublicApiOutput<"/terminals/:terminalId/output", "$get">;
type ThreadTerminalResizeResult = PublicApiOutput<"/terminals/:terminalId/resize", "$post">;
type ThreadTerminalUpdateResult = PublicApiOutput<"/terminals/:terminalId", "$patch">;
type ThreadUnarchiveResult = PublicApiOutput<"/threads/:id/unarchive", "$post">;
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
interface ThreadStatusArgs {
    threadId: string;
}
interface ThreadOpenArgs {
    threadId: string;
    source: PanelFileSource;
    path: string;
    lineNumber: number | null;
}
interface ThreadEventsListArgs {
    afterSeq?: string;
    limit?: string;
    threadId: string;
}
interface ThreadEventWaitArgs {
    afterSeq?: string;
    threadId: string;
    type: string;
    waitMs: string;
}
interface ThreadTimelineArgs extends ThreadTimelineQuery {
    threadId: string;
}
interface ThreadOutputArgs {
    threadId: string;
}
interface ThreadTerminalListArgs {
    threadId: string;
}
interface ThreadTerminalCreateArgs extends Omit<CreateTerminalRequest, "target"> {
    threadId: string;
}
interface ThreadTerminalTargetArgs {
    terminalId: string;
    threadId: string;
}
interface ThreadTerminalUpdateArgs extends ThreadTerminalTargetArgs, UpdateTerminalRequest {
}
interface ThreadTerminalCloseArgs extends ThreadTerminalTargetArgs, CloseTerminalRequest {
}
interface ThreadTerminalInputArgs extends ThreadTerminalTargetArgs, TerminalInputRequest {
}
interface ThreadTerminalResizeArgs extends ThreadTerminalTargetArgs, TerminalResizeRequest {
}
interface ThreadTerminalOutputArgs extends ThreadTerminalTargetArgs, TerminalOutputQuery {
}
interface ThreadInteractionListArgs {
    threadId: string;
}
interface ThreadInteractionGetArgs extends ThreadInteractionListArgs {
    interactionId: string;
}
interface ThreadInteractionResolveArgs extends ThreadInteractionGetArgs {
    resolution: PendingInteractionResolution;
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
    get(args: ThreadInteractionGetArgs): Promise<ThreadInteractionGetResult>;
    list(args: ThreadInteractionListArgs): Promise<ThreadInteractionListResult>;
    resolve(args: ThreadInteractionResolveArgs): Promise<ThreadInteractionResolveResult>;
}
interface ThreadEventsArea {
    list(args: ThreadEventsListArgs): Promise<ThreadEventsListResult>;
    wait(args: ThreadEventWaitArgs): Promise<ThreadEventWaitResult>;
}
interface ThreadTerminalsArea {
    close(args: ThreadTerminalCloseArgs): Promise<ThreadTerminalCloseResult>;
    create(args: ThreadTerminalCreateArgs): Promise<ThreadTerminalCreateResult>;
    input(args: ThreadTerminalInputArgs): Promise<ThreadTerminalInputResult>;
    list(args: ThreadTerminalListArgs): Promise<ThreadTerminalListResult>;
    output(args: ThreadTerminalOutputArgs): Promise<ThreadTerminalOutputResult>;
    resize(args: ThreadTerminalResizeArgs): Promise<ThreadTerminalResizeResult>;
    update(args: ThreadTerminalUpdateArgs): Promise<ThreadTerminalUpdateResult>;
}
interface ThreadsArea {
    archive(args: ThreadStatusArgs): Promise<ThreadArchiveResult>;
    delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
    events: ThreadEventsArea;
    get(args: ThreadGetArgs): Promise<ThreadGetResult>;
    interactions: ThreadInteractionsArea;
    list(args?: ThreadListArgs): Promise<ThreadListResult>;
    open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
    output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
    pin(args: ThreadStatusArgs): Promise<ThreadMutationResult>;
    send(args: ThreadSendArgs): Promise<ThreadSendResult>;
    spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
    stop(args: ThreadStatusArgs): Promise<ThreadStopResult>;
    terminals: ThreadTerminalsArea;
    timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
    unarchive(args: ThreadStatusArgs): Promise<ThreadUnarchiveResult>;
    unpin(args: ThreadStatusArgs): Promise<ThreadMutationResult>;
    update(args: ThreadUpdateArgs): Promise<ThreadMutationResult>;
    wait(args: ThreadWaitArgs): Promise<ThreadWaitResult>;
}
declare function createThreadsArea(args: CreateSdkAreaArgs): ThreadsArea;

interface BbSdk extends BbRealtime {
    automations: ReturnType<typeof createAutomationsArea>;
    connect: ReturnType<typeof createConnectArea>;
    environments: ReturnType<typeof createEnvironmentsArea>;
    files: ReturnType<typeof createFilesArea>;
    guide: ReturnType<typeof createGuideArea>;
    hosts: ReturnType<typeof createHostsArea>;
    projects: ReturnType<typeof createProjectsArea>;
    providers: ReturnType<typeof createProvidersArea>;
    status: ReturnType<typeof createStatusArea>;
    theme: ReturnType<typeof createThemeArea>;
    threads: ReturnType<typeof createThreadsArea>;
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
    sqlite(): Database.Database;
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
    "thread.created": {
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
     * Register rpc methods, served at POST
     * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
     * JSON request body is the input; the response is
     * `{ ok: true, result }` or `{ ok: false, error }`. Inputs and outputs
     * must survive a JSON round-trip — results are serialized with
     * JSON.stringify and nothing else.
     */
    register(handlers: Record<string, (input: never) => unknown>): void;
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
}
interface PluginCliResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
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
     * Register this plugin's `bb` subcommand. One registration per plugin —
     * a second call replaces the first. Core bb commands always win name
     * collisions; reserved names are rejected at registration.
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
     * update_environment_directory guidance). Keep it short.
     */
    instructions?: string;
}
interface PluginAgents {
    /**
     * Register a native dynamic tool (design §4.4). `parameters` is either a
     * zod schema (validated per call; execute receives the parsed value) or a
     * plain JSON-schema object (no validation; execute receives the raw
     * arguments as `unknown`). Tool-set changes apply on the NEXT session
     * start — a tool registered mid-session is not hot-added to running
     * provider sessions. A second registration of the same name within this
     * plugin replaces the first; a name already registered by another plugin
     * is rejected and surfaced as this plugin's status detail.
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
/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
interface PluginMentionSearchContext {
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
     * Runs server-side as the user types after `@` in the composer. Each call
     * is time-boxed (2s) and failure-isolated: a slow or throwing provider
     * contributes an empty list — it can never break the mention menu.
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
    /**
     * Register a thread action rendered in the shipped app's thread header
     * (design §4.9). Multiple actions per plugin; ids must be unique within
     * the plugin. Invoked via POST /plugins/:id/actions/:actionId.
     */
    registerThreadAction(action: PluginThreadActionRegistration): void;
    /**
     * Register an `@`-mention provider for the shipped app's composer
     * (design §4.9). Items group under `label` in the mention menu; a picked
     * item becomes a `{ kind: "plugin" }` mention resource whose context is
     * resolved once at send time. Multiple providers per plugin; ids must be
     * unique within the plugin.
     */
    registerMentionProvider(provider: PluginMentionProviderRegistration): void;
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
    /** Namespaced KV + per-plugin SQLite (design §4.3). */
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
    /** Plugin-reported status (needs-configuration). */
    readonly status: PluginStatusApi;
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
     * Observe thread lifecycle events (design §4.5). Load-safe registration;
     * handlers run async after the transition and never affect it. Errors are
     * caught, logged, and counted against this plugin's handler stats.
     */
    on<E extends PluginThreadEventName>(event: E, handler: PluginThreadEventHandler<E>): void;
    /**
     * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
     * The sanctioned place to clear timers and close connections.
     */
    onDispose(hook: () => void | Promise<void>): void;
}

export { PLUGIN_SDK_APP_EXPORT_NAMES, PLUGIN_SLOT_ID_PATTERN };
export type { BbContext, BbNavigate, BbPluginApi, PluginAgentToolContentPart, PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult, PluginAgents, PluginAppBuilder, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginBackground, PluginCli, PluginCliCommandInfo, PluginCliContext, PluginCliRegistration, PluginCliResult, PluginComposerAccessoryProps, PluginComposerAccessoryRegistration, PluginComposerApi, PluginComposerMention, PluginComposerScope, PluginFileOpenerProps, PluginFileOpenerRegistration, PluginFileOpenerSource, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginHttp, PluginHttpAuthMode, PluginHttpHandler, PluginKvStorage, PluginLogger, PluginMentionItem, PluginMentionProviderRegistration, PluginMentionSearchContext, PluginNavPanelProps, PluginNavPanelRegistration, PluginRealtime, PluginRpc, PluginRpcClient, PluginSdkApp, PluginSettingDescriptor, PluginSettingDescriptors, PluginSettingValue, PluginSettings, PluginSettingsHandle, PluginSettingsState, PluginSettingsValues, PluginStatusApi, PluginStorage, PluginThreadActionContext, PluginThreadActionRegistration, PluginThreadActionResult, PluginThreadActionToast, PluginThreadEventHandler, PluginThreadEventName, PluginThreadEventPayloads, PluginThreadPanelActionContext, PluginThreadPanelActionRegistration, PluginThreadPanelProps, PluginUi };
