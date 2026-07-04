import type {
  ComponentType,
} from "react";

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

// ---------------------------------------------------------------------------
// Slot props (the versioned per-slot contracts).
// ---------------------------------------------------------------------------

/** Props passed to a `homepageSection` component. */
export interface PluginHomepageSectionProps {
  /** Project in view on the compose surface; null when none is selected. */
  projectId: string | null;
}

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
  params: unknown;
}

/** Props passed to a `composerAccessory` component. */
export interface PluginComposerAccessoryProps {
  projectId: string | null;
  threadId: string | null;
}

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

// ---------------------------------------------------------------------------
// Slot registrations (the arguments to `app.slots.*`).
// ---------------------------------------------------------------------------

/**
 * Slot/panel ids and nav-panel paths must match this pattern (letters,
 * digits, `-`, `_`): they ride URLs and persisted panel-tab keys.
 */
export const PLUGIN_SLOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface PluginHomepageSectionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  component: ComponentType<PluginHomepageSectionProps>;
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
  openPanel(options?: { title?: string; params?: unknown }): void;
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

// ---------------------------------------------------------------------------
// definePluginApp
// ---------------------------------------------------------------------------

export interface PluginAppSlots {
  homepageSection(registration: PluginHomepageSectionRegistration): void;
  navPanel(registration: PluginNavPanelRegistration): void;
  threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
  composerAccessory(registration: PluginComposerAccessoryRegistration): void;
  fileOpener(registration: PluginFileOpenerRegistration): void;
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

export interface PluginRpcClient {
  /**
   * Invoke one of the plugin's `bb.rpc` methods (POST
   * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
   * result; rejects with an `Error` carrying the server's message when the
   * handler fails or the plugin is not running.
   */
  call(method: string, input?: unknown): Promise<unknown>;
}

export interface PluginSettingsState {
  /**
   * Effective non-secret setting values (secret settings are excluded —
   * read them server-side). Undefined while loading or unavailable.
   */
  values: Record<string, string | boolean> | undefined;
  isLoading: boolean;
}

/** Where `useComposer()` writes: the active thread's draft or the new-thread draft. */
export type PluginComposerScope =
  | { kind: "thread"; threadId: string }
  | { kind: "new-thread"; projectId: string | null };

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
 * write to. Inside a thread context writes land in that thread's draft;
 * anywhere else (nav panel, homepage section) they seed the new-thread
 * composer draft, which persists until the user sends or clears it.
 */
export interface PluginComposerApi {
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
}

// ---------------------------------------------------------------------------
// The whole surface + its runtime export names.
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
export const PLUGIN_SDK_APP_EXPORT_NAMES = [
  "definePluginApp",
  "useBbContext",
  "useBbNavigate",
  "useComposer",
  "useRealtime",
  "useRpc",
  "useSettings",
] as const satisfies readonly (keyof PluginSdkApp)[];

// Compile-time exhaustiveness: every PluginSdkApp key must appear in
// PLUGIN_SDK_APP_EXPORT_NAMES (the `satisfies` above covers the converse).
type MissingExportName = Exclude<
  keyof PluginSdkApp,
  (typeof PLUGIN_SDK_APP_EXPORT_NAMES)[number]
>;
const _assertAllExported: MissingExportName extends never ? true : never =
  true;
void _assertAllExported;
