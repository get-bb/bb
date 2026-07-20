import type { ComponentType } from "react";
import type { JsonValue } from "./json-value.js";
import type {
  PluginRpcCallArgs,
  PluginRpcContract,
  PluginRpcResult,
} from "./rpc-contract.js";

/**
 * The `@bb/plugin-sdk/app` contract (plugin design §5.2) — pure types with no
 * side effects. The BB app imports these to keep its real implementation in
 * sync (`satisfies PluginSdkApp`). Plugin authors import the same shapes through
 * `@bb/plugin-sdk/app`.
 *
 * Per-slot props are versioned contracts: additive-only within an SDK major.
 */

// ---------------------------------------------------------------------------
// Slot props (the versioned per-slot contracts).
// ---------------------------------------------------------------------------

/** Props passed to a `homepageSection` component. */
export interface PluginHomepageSectionProps {
  /** Project in view on the compose surface; null when none is selected. */
  projectId: string | null;
}

/**
 * Props passed to a `settingsSection` component.
 *
 * Deliberately empty in V1; versioned additive like the other slot props.
 */
export interface PluginSettingsSectionProps {}

/** Props passed to a `navPanel` component (it owns its whole route). */
export interface PluginNavPanelProps {
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
export interface PluginThreadPanelProps {
  threadId: string;
  /**
   * The JSON value the action's `openPanel` call passed (round-tripped
   * through persistence, so the tab restores across reloads); null when the
   * action opened the panel without params.
   */
  params: JsonValue | null;
}

/** Props passed to a `composerAccessory` component. */
export interface PluginComposerAccessoryProps {
  /** The active composer's project. Root compose uses its selected project. */
  projectId: string | null;
  /** The active composer's thread, or null for a new-thread composer. */
  threadId: string | null;
}

export interface PluginPendingInteractionView {
  id: string;
  threadId: string;
  title: string;
  payload: JsonValue;
  createdAt: number;
  expiresAt: number | null;
}

export interface PluginPendingInteractionProps {
  interaction: PluginPendingInteractionView;
  submit(value: JsonValue): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * Props for a `sidebarFooterAction` — host-rendered (no plugin component).
 * Deliberately empty; the registration's `run` carries the behavior.
 */
export interface PluginSidebarFooterActionProps {}

/**
 * Where a file being opened by a `fileOpener` lives. `path` semantics follow
 * the source: workspace paths are relative to the environment's worktree,
 * thread-storage paths are relative to the thread's storage root, host paths
 * are absolute on the thread's host.
 */
export interface PluginFileOpenerSource {
  kind: "workspace" | "host" | "thread-storage";
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
}

/** Props passed to a `fileOpener` component (rendered as a panel file tab). */
export interface PluginFileOpenerProps {
  path: string;
  source: PluginFileOpenerSource;
}

/**
 * Message context passed to a `messageDirective` component — the assistant
 * (or nested agent) message that contained the directive.
 */
export interface PluginMessageDirectiveMessage {
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
export type PluginMessageDirectiveOpenWorkspaceFile = (path: string) => boolean;

export interface PluginMessageDirectiveThreadPanelOptions {
  /** A `threadPanelAction` id registered by this same plugin. */
  actionId: string;
  title?: string;
  params?: JsonValue;
}

/** Open this plugin's registered action in the current thread side panel. */
export type PluginMessageDirectiveOpenThreadPanel = (
  options: PluginMessageDirectiveThreadPanelOptions,
) => boolean;

/**
 * Props passed to a `messageDirective` component. Attributes are untrusted
 * strings parsed from the directive; the plugin validates its own fields.
 */
export interface PluginMessageDirectiveProps {
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

// ---------------------------------------------------------------------------
// Slot registrations (the arguments to `app.slots.*`).
// ---------------------------------------------------------------------------

export interface PluginHomepageSectionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  component: ComponentType<PluginHomepageSectionProps>;
}

export interface PluginSettingsSectionRegistration {
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

export interface PluginNavPanelRegistration {
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
export interface PluginThreadPanelActionContext {
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
  openPanel(options?: { title?: string; params?: JsonValue }): void;
}

export interface PluginThreadPanelActionRegistration {
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

export interface PluginComposerAccessoryRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  component: ComponentType<PluginComposerAccessoryProps>;
}

export interface PluginPendingInteractionRegistration {
  /** Matches `rendererId` passed to `bb.ui.requestInput`. */
  id: string;
  component: ComponentType<PluginPendingInteractionProps>;
}

/** Context handed to a `sidebarFooterAction`'s `run`. */
export interface PluginSidebarFooterActionContext {
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
export interface PluginSidebarFooterActionRegistration {
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
export interface PluginFileOpenerRegistration {
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
export interface PluginMessageDirectiveRegistration {
  /**
   * The directive name. Lowercase kebab-case beginning with a letter.
   */
  id: string;
  component: ComponentType<PluginMessageDirectiveProps>;
}

/**
 * A narrow, stable reference to one rendered chat message — NOT an internal
 * timeline row. `sourceSeqEnd` is the last source event sequence the message
 * covers, the anchor the server accepts for provider-history forks.
 */
export interface ThreadChatMessageReference {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  /** Visible text of the message. */
  text: string;
  sourceSeqEnd: number;
}

export interface PluginMessageActionThreadPanelOptions {
  /** A `threadPanelAction` id registered by this same plugin. */
  actionId: string;
  title?: string;
  params?: JsonValue;
}

/** Context handed to a `messageAction`'s `run`. */
export interface PluginMessageActionContext {
  /** The thread whose timeline surfaced the action. */
  threadId: string;
  message: ThreadChatMessageReference;
  /**
   * Present only when the action was invoked from the text-selection menu;
   * the exact text the user highlighted inside `message`.
   */
  selectedText?: string;
  /**
   * Open one of this plugin's `threadPanelAction` components in the current
   * thread's side panel — same semantics as the message-directive
   * `openThreadPanel`. Returns true when the host accepted (the action id
   * exists and the surface has a panel); false otherwise.
   */
  openPanel(options: PluginMessageActionThreadPanelOptions): boolean;
}

/**
 * An action on chat messages: an icon button in the per-message action bar
 * (user and assistant messages) and an entry in the assistant-message
 * text-selection menu. Host-rendered chrome — the plugin supplies title,
 * icon hint, and `run` behavior only.
 */
export interface PluginMessageActionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Tooltip / menu label for the action. */
  title: string;
  /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
  icon?: string;
  /**
   * Runs when the user activates the action. Errors (sync or async) are
   * contained and logged; they never break the timeline.
   */
  run(context: PluginMessageActionContext): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// definePluginApp
// ---------------------------------------------------------------------------

export interface PluginAppSlots {
  homepageSection(registration: PluginHomepageSectionRegistration): void;
  settingsSection(registration: PluginSettingsSectionRegistration): void;
  navPanel(registration: PluginNavPanelRegistration): void;
  threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
  composerAccessory(registration: PluginComposerAccessoryRegistration): void;
  pendingInteraction(registration: PluginPendingInteractionRegistration): void;
  sidebarFooterAction(
    registration: PluginSidebarFooterActionRegistration,
  ): void;
  fileOpener(registration: PluginFileOpenerRegistration): void;
  messageDirective(registration: PluginMessageDirectiveRegistration): void;
  messageAction(registration: PluginMessageActionRegistration): void;
}

export interface PluginAppBuilder {
  slots: PluginAppSlots;
}

export type PluginAppSetup = (app: PluginAppBuilder) => void;

/**
 * The opaque product of `definePluginApp` — a plugin's `app.tsx` default
 * export. The host re-runs `setup` against a fresh collector on every
 * (re)interpretation, replacing that plugin's registrations wholesale.
 */
export interface PluginAppDefinition {
  /** Brand the host checks before interpreting a bundle's default export. */
  readonly __bbPluginApp: true;
  readonly setup: PluginAppSetup;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface PluginRpcClient<
  Contract extends PluginRpcContract = PluginRpcContract,
> {
  /**
   * Invoke one of the plugin's `bb.rpc` methods (POST
   * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
   * inferred output; rejects with an `Error` carrying the server's message,
   * stable `code`, and validation `issues` when present.
   */
  call<Method extends Extract<keyof Contract, string>>(
    method: Method,
    ...args: PluginRpcCallArgs<Contract[Method]>
  ): Promise<PluginRpcResult<Contract[Method]>>;
}

export interface PluginSettingsState {
  /**
   * Effective non-secret setting values (secret settings are excluded —
   * read them server-side). Undefined while loading or unavailable.
   */
  values: Record<string, string | boolean> | undefined;
  isLoading: boolean;
}

/** State of the app's shared realtime connection to the bb server. */
export type PluginRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting";

/** Where `useComposer()` writes. */
export type PluginComposerScope =
  | { kind: "thread"; threadId: string }
  | {
      kind: "queued-message";
      threadId: string;
      queuedMessageId: string;
    }
  | {
      kind: "side-chat";
      projectId: string;
      parentThreadId: string;
      tabId: string;
      childThreadId: string | null;
    }
  | {
      kind: "new-thread";
      /** Root compose's effective selected project; null only while unresolved. */
      projectId: string | null;
    };

/** Host-rendered paint applied to the editable composer text. */
export type PluginComposerTextEffect = "shimmer";

/** Host-rendered status that temporarily replaces a thread's draft glyph. */
export interface PluginComposerThreadRowStatus {
  /** BB icon-name hint; unknown names fall back to the generic plugin icon. */
  icon: string;
  /** Accessible label for the status glyph. */
  label: string;
  /** Host-rendered motion treatment for the status glyph, or null. */
  effect: PluginComposerTextEffect | null;
  /** Semantic host color for the status glyph. Defaults to the neutral tone. */
  tone?: "default" | "success";
}

/** An @-mention pill bound to one of the calling plugin's mention providers. */
export interface PluginComposerMention {
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
 * write to. While a queued message is being edited, writes land in that
 * message's inline editor. In a side chat, writes land in the visible side-chat
 * draft. Otherwise, inside a thread context writes land in that thread's draft;
 * anywhere else (nav panel, homepage section) they seed the new-thread composer
 * draft, which persists until the user sends or clears it.
 */
export interface PluginComposerApi {
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
   * Apply a host-rendered effect to this composer's editable text, or clear it.
   * Effects are scoped to the calling plugin and automatically clear when the
   * slot unmounts or its composer scope changes.
   */
  setTextEffect(effect: PluginComposerTextEffect | null): void;
  /**
   * Replace this composer's thread-row draft glyph with a host-rendered status,
   * or clear it. New-thread composers have no row, so calls are a no-op.
   * Side-chat and queued side-chat scopes decorate the visible parent-thread
   * row. Status is scoped to the calling plugin and automatically clears when
   * the slot unmounts or its composer scope changes.
   */
  setThreadRowStatus(status: PluginComposerThreadRowStatus | null): void;
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

// ---------------------------------------------------------------------------
// ThreadChat — the host-owned chat component.
// ---------------------------------------------------------------------------

/**
 * Props of the host-owned `ThreadChat` component — one thread's chat
 * (timeline, and for the composer variants the full send/queue/draft
 * engine), rendered by the BB app inside a plugin slot. This is the
 * deliberate exception to the no-host-components rule (§5.5): a stable
 * product capability, not a UI kit. Versioned additive like slot props;
 * internal timeline rows, query hooks, and prompt-box configuration are
 * deliberately not exposed.
 */
export interface ThreadChatProps {
  threadId: string;
  /**
   * "full" (default) is the page presentation (centered reading width);
   * "compact" is the side-panel presentation; "timeline" renders the
   * transcript without a composer.
   */
  variant?: "full" | "compact" | "timeline";
  /**
   * "contained" (default) fills and scrolls inside a bounded parent;
   * "document" grows with its content and defers scrolling to the page.
   */
  layout?: "contained" | "document";
  /** Bump to focus the composer (ignored by `variant: "timeline"`). */
  focusRequest?: number;
  className?: string;
}

/** Current app selection, derived from the route. */
export interface BbContext {
  projectId: string | null;
  threadId: string | null;
}

export interface BbNavigate {
  toThread(threadId: string): void;
  toProject(projectId: string): void;
  /**
   * Navigate to one of this plugin's own nav panels by its `path`.
   * `subPath` targets a location inside the panel (the component's
   * `subPath` prop); `replace` swaps the current history entry instead of
   * pushing — use it for redirects so back does not bounce.
   */
  toPluginPanel(
    path: string,
    options?: { subPath?: string; replace?: boolean },
  ): void;
  /**
   * Navigate to the root compose surface (the new-thread screen). Pass
   * `initialPrompt` to seed the composer draft and `focusPrompt` to focus the
   * composer on arrival — the pairing behind "Create via chat" style entry
   * points that drop the user into chat with a prefilled prompt.
   */
  toCompose(options?: { initialPrompt?: string; focusPrompt?: boolean }): void;
}

// ---------------------------------------------------------------------------
// The whole runtime surface. Declaration-versus-runtime parity is tested
// against the actual `@bb/plugin-sdk/app` module namespace.
//
// Components are deliberately NOT part of this surface (removed 2026-07-03,
// plugin design §5.5): plugins vendor shadcn-style component source from the
// BB registry (`npx shadcn add @bb/<name>`) and own it. `bb plugin build`
// shims react + the shared-singleton packages (portal radix families,
// sonner, vaul); everything else bundles per plugin. Freezing 65 component
// prop types here made every host component change a plugin-breaking change.
// ---------------------------------------------------------------------------

/**
 * Everything `@bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
export interface PluginSdkApp {
  definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
  useRpc<
    Contract extends PluginRpcContract = PluginRpcContract,
  >(): PluginRpcClient<Contract>;
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
  /**
   * The host-owned chat component (see {@link ThreadChatProps}) — the one
   * component the SDK ships. Everything else stays vendored per §5.5.
   */
  ThreadChat: ComponentType<ThreadChatProps>;
}
