import type {
  ExperimentalRpcKeyedMethod,
  ExperimentalRpcKeyedValue,
  experimental_PluginRpcCallError,
  PluginRpcCallArgs,
  PluginRpcContract,
  PluginRpcMethodContract,
  StandardSchemaV1InferInput,
  PluginRpcResult,
} from "./rpc-contract.js";
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  ComponentType,
  CSSProperties,
  ReactNode,
  RefObject,
} from "react";
import type {
  PermissionMode,
  PromptInput,
  ProviderInfo,
  ReasoningLevel,
  ServiceTier,
  SessionOptionSelections,
  EnvironmentWorkspaceDisplayKind,
  ThreadQueuedWork,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
  WorkspaceGitOperation,
} from "@bb/domain";
import type {
  CreateExecutionInputSources,
  CreateThreadEnvironmentArgs,
} from "@bb/server-contract";
import type {
  BbSdkAreas,
  PluginThreadMetadataListArgs,
  PluginThreadMetadataListResult,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataResult,
  ThreadPluginMetadataUpdateArgs,
} from "@bb/sdk";
import type { JsonValue } from "./json-value.js";
import type { PluginMentionTrigger } from "./backend-contract.js";

/**
 * The `@get-bb/plugin-sdk/app` contract (plugin design §5.2) — pure types with no
 * side effects. The BB app imports these to keep its real implementation in
 * sync (`satisfies PluginSdkApp`). Plugin authors import the same shapes through
 * `@get-bb/plugin-sdk/app`.
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

/**
 * Props passed to an `experimental_appOverlay` component.
 *
 * Deliberately empty while the component reads live app state through SDK
 * hooks; versioned additive like the other slot props.
 */
export interface ExperimentalAppOverlayProps {}

export type ExperimentalPageTitle = (
  | { title: string; breadcrumbs?: never }
  | { title?: never; breadcrumbs: readonly ExperimentalPageBreadcrumb[] }
) & { windowTitle?: string };

export interface ExperimentalPageBreadcrumb {
  label: string;
  /** Absolute app route, starting with a single slash. */
  to?: string;
}

/** Props passed to a `navPanel` component (it owns its whole route). */
export interface PluginNavPanelProps {
  /**
   * The route remainder after the panel root, "" at the root, as it appears
   * in the URL: each segment stays percent-encoded. The panel's route is
   * `/plugins/<pluginId>/<path>/*`, so a deep link like
   * `/plugins/notes/notes/work/my%20ideas.md` renders the panel with
   * `subPath: "work/my%20ideas.md"`. Decode each segment with
   * `decodeURIComponent` before using it. Navigate within the panel via
   * `useBbNavigate().toPluginPanel(path, { subPath })`, which takes
   * unencoded segments and encodes them — browser back/forward then walks
   * panel-internal history.
   */
  subPath: string;
}

/**
 * Props passed to a panel tab opened by a thread action tab.
 *
 * This slot is rendered only for an existing thread. Use
 * `experimental_newThreadPanelAction` for the root New thread screen.
 */
export interface ExperimentalThreadActionTabProps extends ExperimentalThreadTabProps {
  /**
   * The JSON `params` the tab was opened with (round-tripped through
   * persistence, so the tab restores across reloads); null when it was
   * opened without params.
   */
  params: JsonValue | null;
}

/** Props every thread tab receives, fixed or action. */
export interface ExperimentalThreadTabProps {
  threadId: string;
  /**
   * The thread's environment, taken from the thread so it is present on the
   * first render; null only when the thread has no environment. The tab reads
   * whatever it needs about the environment itself and handles loading and
   * failure there.
   */
  environment: ExperimentalThreadEnvironment | null;
}

/** Props passed to a panel tab opened by `experimental_newThreadPanelAction`. */
export interface PluginNewThreadPanelProps {
  /** Project selected in the root composer; null in projectless compose. */
  projectId: string | null;
  /**
   * The JSON `params` the tab was opened with (round-tripped through
   * persistence, so the tab restores across reloads); null when it was
   * opened without params.
   */
  params: JsonValue | null;
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

/** Display and accessibility metadata for a host-owned answer shortcut. */
export interface ExperimentalQuestionShortcut {
  label: string;
  ariaKeyshortcuts: string;
}

/**
 * The keyboard shortcuts bb binds while a pending interaction is open. The
 * host owns the bindings (users can remap them); a form shows them and decides
 * what choosing an option means.
 */
export interface ExperimentalQuestionFormHost {
  /**
   * Shortcut per zero-based option index, as a string (`"0"` is the first
   * option). Missing entries have no binding.
   */
  shortcuts: ReadonlyMap<string, ExperimentalQuestionShortcut>;
  /**
   * Receive the index of the option the person chose with a shortcut while
   * the thread's pane is focused. Return true when the index names an option
   * the form handled. The last registered handler wins; call the returned
   * function to unregister.
   */
  registerChoiceHandler(handler: (index: number) => boolean): () => void;
}

/**
 * Props of the host-owned `experimental_VoiceInputTextarea`: a controlled
 * textarea with bb's voice input. Other textarea attributes, including `ref`
 * and `className`, reach the underlying `<textarea>`; the caller styles it and
 * the host adds room for its microphone controls when voice input is
 * available.
 */
export interface ExperimentalVoiceInputTextareaProps extends Omit<
  ComponentPropsWithRef<"textarea">,
  "value" | "defaultValue" | "onChange" | "children"
> {
  value: string;
  /**
   * Receives typed edits and finished transcripts, which the host appends to
   * `value`. Transcripts stay editable and are never submitted.
   */
  onValueChange(value: string): void;
  /**
   * True from the start of recording until transcription finishes or is
   * cancelled, and false on unmount. Hold submission while it is true.
   */
  onVoiceInputActiveChange?(active: boolean): void;
}

/**
 * Props for a `sidebarFooterAction` — host-rendered (no plugin component).
 * Deliberately empty; the registration's `run` carries the behavior.
 */
export interface PluginSidebarFooterActionProps {}

/** Props passed to an experimental sidebar-footer disclosure component. */
export interface ExperimentalSidebarFooterDisclosureProps {
  /** Hide this disclosure without affecting another plugin's open disclosure. */
  dismiss(): void;
}

/** Display and accessibility metadata for a host-owned sidebar shortcut. */
export interface ExperimentalSidebarNavigationShortcut {
  label: string;
  ariaKeyShortcuts: string;
}

/** Host-owned behavior represented by one sidebar navigation item. */
export type ExperimentalSidebarNavigationAction =
  | { kind: "new-thread" }
  | { kind: "search-threads" }
  | { kind: "open-extensions" }
  | { kind: "open-skills" }
  | {
      kind: "open-plugin-panel";
      pluginId: string;
      panelId: string;
    };

/**
 * Semantic icon identity for one sidebar navigation item. Render it with
 * {@link PluginSdkApp.experimental_SidebarNavigationIcon} to match bb's
 * artwork, including panel icons with plugin branding as their fallback.
 */
export type ExperimentalSidebarNavigationIcon =
  | { kind: "host"; name: "new-thread" | "search" | "extensions" | "skills" }
  | { kind: "plugin"; pluginId: string; icon: string | null };

/** One host-owned destination or action a navigation provider arranges. */
export interface ExperimentalSidebarNavigationItem {
  /**
   * Arrangement key, stable across reloads: `__bb__/new-thread`,
   * `__bb__/search-threads`, `__bb__/extensions`, `__bb__/skills`,
   * `__bb__/automations`, or `<pluginId>/<panelId>`. The same keys appear in
   * the `sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`
   * settings.
   */
  id: string;
  label: string;
  icon: ExperimentalSidebarNavigationIcon;
  action: ExperimentalSidebarNavigationAction;
  isDisabled: boolean;
  /**
   * False when the user hid the item. Draw hidden items in an overflow menu
   * rather than dropping them, so they stay reachable. New thread is always
   * visible.
   */
  isVisible: boolean;
  /**
   * A plugin panel remembered from the last session whose bundle has not
   * registered yet. Activating it does nothing until it loads.
   */
  isLoading: boolean;
  /**
   * The plugin that contributed this panel; null for bb's own items. Gates
   * `openDetails` and `disablePlugin`.
   */
  pluginId: string | null;
  shortcut: ExperimentalSidebarNavigationShortcut | null;
  /**
   * The panel's current {@link PluginNavPanelRegistration.experimental_useBadge}
   * value, or null. Add `label` to the item's accessible name when you draw
   * it.
   */
  badge: ExperimentalBadge | null;
}

/**
 * Where the host opens a sidebar navigation destination: `current` in the
 * current view, `split` in a pane with browser-tab fallback, `tab` in a new browser tab.
 */
export type ExperimentalSidebarNavigationTarget = "current" | "split" | "tab";

/** How the host should activate a sidebar navigation item. */
export interface ExperimentalSidebarNavigationActivationOptions {
  target: ExperimentalSidebarNavigationTarget;
}

/**
 * Host behavior for sidebar navigation items (see
 * {@link ExperimentalSidebarNavigationState}). Unknown item ids are ignored.
 * Calls made after the calling component unmounts do nothing.
 */
export interface ExperimentalSidebarNavigationActions {
  /**
   * Run the item's host behavior at `target`. Plugin panels close the
   * mobile sidebar drawer; Plugins and Skills swap the list beside the
   * navigation. `split` opens a pane, or focuses the destination's existing
   * pane. At the pane limit it replaces the focused pane. If the destination
   * cannot be a pane, splitting is disabled, the viewport is compact, or no
   * split layout exists, it opens a browser tab instead. Callers do not need
   * to check availability. Search remains a
   * command at every target. Disabled or loading items do nothing. `split` and `tab`
   * must run synchronously from a user gesture; native shells handle the
   * new-window request using their existing policy.
   */
  activate(
    itemId: string,
    options: ExperimentalSidebarNavigationActivationOptions,
  ): void;
  /**
   * Return to the thread list and the last thread or new thread screen the
   * user had open before visiting Settings, Plugins, Skills, or a plugin
   * panel. Target `tab` instead opens the new thread screen in a browser
   * tab, with the same user-gesture requirement as `activate`. Omitting
   * `options` navigates in place.
   */
  goHome(options?: {
    target: Exclude<ExperimentalSidebarNavigationTarget, "split">;
  }): void;
  /** Hide or show one item. Persists to `sidebar.visiblePluginPanels`. */
  setVisible(itemId: string, isVisible: boolean): void;
  /**
   * Save a new order. Pass item ids in the order you want; unknown ids are
   * dropped and ids you leave out keep their relative order after the ones
   * you pass. Persists to `sidebar.pluginPanelOrder`.
   */
  setOrder(itemIds: readonly string[]): void;
  /**
   * Open bb's customize editor, which reorders and hides items, beside the
   * navigation. It waits for an open menu to close and returns focus to the
   * control that opened it.
   */
  openCustomize(): void;
  /** Open the owning plugin's details. Does nothing when `pluginId` is null. */
  openDetails(itemId: string): void;
  /**
   * Disable the owning plugin, leave its panel if it is open, and show a
   * toast. Rejects after the host's error toast when disabling fails. Does
   * nothing when `pluginId` is null.
   */
  disablePlugin(itemId: string): Promise<void>;
}

/** What {@link PluginSdkApp.experimental_useSidebarNavigation} returns. */
export interface ExperimentalSidebarNavigationState {
  /** Every item in the user's saved order, visible and hidden. */
  items: readonly ExperimentalSidebarNavigationItem[];
  /** The item whose destination the route currently shows, or null. */
  activeItemId: string | null;
  /**
   * True on the thread list's routes: a thread, the new thread screen, or a
   * project page. Settings, Plugins, Skills, and plugin panels are not home.
   */
  isHomeActive: boolean;
  /**
   * True while the user holds the app command modifier, when bb's own
   * navigation reveals its `shortcut` labels. Show yours at the same time.
   */
  isShortcutModifierHeld: boolean;
  actions: ExperimentalSidebarNavigationActions;
}

/**
 * Per-item drag-to-split support (see
 * {@link PluginSdkApp.experimental_useSidebarNavigationSplit}). Same contract
 * as {@link PluginSidebarThreadSplit}.
 */
export interface ExperimentalSidebarNavigationSplit {
  /**
   * Spread onto the item's interactive element. Empty when the item cannot
   * open in a pane, so spreading it is always safe.
   */
  splitProps: {
    onPointerDown?: (event: import("react").PointerEvent<HTMLElement>) => void;
  };
  /**
   * False for items that cannot open in a pane (Search, Plugins, Skills), on
   * compact viewports, and when splits are unavailable.
   */
  isAvailable: boolean;
  /** Where this item's destination sits in the split layout, or null. */
  layout: { panes: readonly PluginSidebarSplitPane[] } | null;
}

/** Options for {@link PluginSdkApp.experimental_useSidebarNavigationSplit}. */
export interface ExperimentalSidebarNavigationSplitOptions {
  /**
   * `sidebar` (the default) engages the drag once the pointer leaves the
   * sidebar, so a row list with its own drag-to-reorder keeps working.
   * `distance` engages after a short movement in any direction; use it for
   * rows inside a menu or popover that covers the main area.
   */
  activation?: "sidebar" | "distance";
  /** Called when the drag engages, for example to close the menu the row is in. */
  onDragStart?: () => void;
}

/** Props for {@link PluginSdkApp.experimental_SidebarNavigationIcon}. */
export interface ExperimentalSidebarNavigationIconProps {
  icon: ExperimentalSidebarNavigationIcon;
  className?: string;
}

/**
 * Where a sidebar navigation provider draws (see
 * {@link ExperimentalSidebarNavigationRegistration.placement}).
 */
export type ExperimentalSidebarNavigationPlacement = "rail" | "list";

/**
 * Props passed to an `experimental_sidebarNavigation` component. Read the
 * items and their actions with
 * {@link PluginSdkApp.experimental_useSidebarNavigation}.
 */
export interface ExperimentalSidebarNavigationProps {
  isCompactViewport: boolean;
  placement: ExperimentalSidebarNavigationPlacement;
  /**
   * Renders the bundled Navigation plugin's provider for the same placement,
   * Rail or Top list, or nothing when that plugin is disabled. Kept for
   * plugins written before `experimental_useSidebarNavigation`; render items
   * from that hook instead. Scheduled for removal.
   *
   * @deprecated
   */
  experimental_Original: ComponentType;
}

/**
 * Props passed to a navigation's `headerComponent`, rendered in the sidebar's
 * header row between the sidebar toggle (and the macOS window controls) and
 * bb's back and forward buttons.
 */
export interface ExperimentalSidebarHeaderProps {
  /**
   * Width in px of the space the component may use, updated when the sidebar
   * resizes or the window chrome changes. It can be smaller than
   * `controlSize` in a narrow sidebar.
   */
  width: number;
  /**
   * Width and height in px of the header's own buttons, equal to the
   * `--bb-sidebar-control-size` CSS variable. Size your controls to match.
   */
  controlSize: number;
  isCompactViewport: boolean;
}

/**
 * Props passed to an `experimental_threadList` component — the sidebar's
 * scrolling thread area, replaced wholesale by one plugin.
 */
export interface PluginThreadListProps {
  /** The thread the route currently shows; null on non-thread routes. */
  activeThreadId: string | null;
  /** The project the route currently shows; null when none is selected. */
  activeProjectId: string | null;
  /** True on phone-width viewports and coarse pointers. */
  isCompactViewport: boolean;
  /**
   * Call after the user opens a thread. It closes the mobile sidebar drawer.
   */
  onNavigate: () => void;
  /**
   * Compatibility value for the former sidebar search field. BB now searches
   * threads in the quick palette, so the host always supplies "".
   *
   * @deprecated The quick palette owns thread search. Ignore this value.
   */
  searchQuery: string;
}

/** JavaScript world a Browser page expression runs in. */
export type ExperimentalPluginBrowserPageWorld = "isolated" | "main";

export interface ExperimentalPluginBrowserPageEvaluateOptions {
  /**
   * `isolated` (default) runs in a BB-owned world that shares the page DOM but
   * not page globals, and binds `bb.postMessage(data)`. `main` runs beside the
   * page's own scripts, where `bb` is `null`.
   */
  world?: ExperimentalPluginBrowserPageWorld;
}

/**
 * Script access to the top-level document of one Browser tab. Independent of
 * CDP control leases: it never attaches a debugger or shows a control banner.
 */
export interface ExperimentalPluginBrowserPage {
  /**
   * Evaluate a JavaScript expression and resolve its JSON-serialized value.
   * Promises are awaited and `undefined` resolves to `null`. The expression
   * can reference `bb`. Rejects when the tab is gone or the expression throws.
   * Anything the expression installs is lost when the document navigates.
   */
  evaluate(
    expression: string,
    options?: ExperimentalPluginBrowserPageEvaluateOptions,
  ): Promise<JsonValue>;
  /**
   * Subscribe to values this plugin's isolated-world scripts in this tab send
   * with `bb.postMessage(data)`. Returns the unsubscribe function.
   */
  onMessage(listener: (data: JsonValue) => void): () => void;
}

export interface ExperimentalPluginBrowserToolbarActionProps {
  /** Thread that owns the Browser tab. */
  threadId: string;
  /** Browser tab currently rendering the action. */
  tabId: string;
  /** Current top-level URL shown in the address bar. */
  url: string;
  /** True when the Browser chrome needs compact controls. */
  isCompactViewport: boolean;
  /** Script access to this tab's page; `null` outside the desktop app. */
  experimental_page: ExperimentalPluginBrowserPage | null;
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
  /**
   * Explicit host selected for a project-backed workspace file. Omitted when
   * the source is resolved by its environment/thread or the primary host.
   *
   * @experimental Audit before relying on this as a stable contract.
   */
  experimental_hostId?: string;
}

/** Props passed to a `fileOpener` component (rendered as a panel file tab). */
export interface PluginFileOpenerProps {
  path: string;
  source: PluginFileOpenerSource;
  /**
   * One-based, inclusive lines requested by the latest file open, or null when
   * untargeted. BB supplies a new object for each targeted open, including an
   * identical target in the active tab. Observe object identity to navigate
   * again; keep the editor model intact. Older hosts may omit this prop.
   *
   * @experimental Audit navigation, remount, and persistence semantics before stabilizing.
   */
  experimental_lineRange?: {
    startLineNumber: number;
    endLineNumber: number;
  } | null;
  /**
   * BB's file preview, bound to this file. Render it to delegate conditionally
   * without re-entering plugin replacement resolution.
   *
   * @experimental Audit before relying on this as a stable contract.
   */
  Original: ComponentType;
}

// ---------------------------------------------------------------------------
// Host-owned code rendering (SourceCode / Diff) — the public components and
// the props their replacements receive.
// ---------------------------------------------------------------------------

/** How a code line longer than the viewport is presented. */
export type CodeOverflowMode = "scroll" | "wrap";

/** How a diff presents its two sides. */
export type DiffViewMode = "unified" | "split";

/** A 1-based, inclusive line range. */
export interface SourceCodeLineRange {
  start: number;
  end: number;
}

/** One complete text side of a diff, resolved by the caller. */
export interface ExperimentalDiffFileContent {
  /** File path for this side. May differ between `old` and `new` for a rename. */
  path: string;
  /** Complete UTF-8 file contents, including unchanged lines outside the patch. */
  content: string;
}

/** Complete text contents for both sides of a diff. */
export interface ExperimentalDiffFullFileContents {
  old: ExperimentalDiffFileContent;
  new: ExperimentalDiffFileContent;
}

/**
 * Props of the host-owned `experimental_SourceCode` component — BB's source
 * viewer. The host owns syntax highlighting, gutters, wrapping, line-selection
 * presentation, and the live BB code theme; the caller owns loading the text
 * and any surrounding chrome. Inside a thread view, selected lines offer Add to
 * chat, which quotes them into that thread's composer.
 */
export interface SourceCodeProps {
  /** The complete source text to render. */
  content: string;
  /** File path or name. Drives language detection and the a11y label. */
  path: string;
  /** Long-line presentation. Defaults to `"scroll"`. */
  overflow?: CodeOverflowMode;
  /**
   * Lines to highlight and scroll into view (1-based, inclusive). Defaults to
   * `null` — nothing highlighted.
   */
  highlightedLines?: SourceCodeLineRange | null;
  /** Applied to the renderer's root element. */
  className?: string;
}

/**
 * Props of the host-owned `experimental_Diff` component — BB's diff viewer.
 * The host owns patch normalization (a patch without a `diff --git` header is
 * completed from `path`), syntax highlighting, unified/split presentation,
 * gutters, line-selection presentation, optional full-file context expansion,
 * and the live BB code theme. Inside a thread view, selected lines offer Add
 * to chat, which quotes them into that thread's composer. Content that cannot
 * be parsed as a patch degrades to plain monospace text.
 */
export interface DiffProps {
  /** Unified patch text for exactly ONE file. */
  patch: string;
  /**
   * The file the patch applies to. Used to complete a patch that arrives
   * without a `diff --git` header (GitHub's REST patches, single `@@` hunks)
   * and for language detection.
   */
  path: string;
  /** Side-by-side or inline. Defaults to `"unified"`. */
  view?: DiffViewMode;
  /** Long-line presentation. Defaults to `"scroll"`. */
  overflow?: CodeOverflowMode;
  /** Whether the gutter shows line numbers. Defaults to `true`. */
  showLineNumbers?: boolean;
  /**
   * Complete text for both file sides. When present and consistent with the
   * patch, BB enables expand-context controls between hunks. The caller owns
   * loading these contents; omit the field to render from the patch alone.
   */
  experimental_fullFileContents?: ExperimentalDiffFullFileContents;
  /** Applied to the renderer's root element. */
  className?: string;
}

/**
 * Props passed to an `experimental_sourceCodeRenderer` component. Every value
 * is already resolved — the replacement never re-applies a host default.
 */
export interface PluginSourceCodeRendererProps {
  content: string;
  path: string;
  overflow: CodeOverflowMode;
  highlightedLines: SourceCodeLineRange | null;
  /**
   * BB's source renderer, bound to this request. Render it to delegate
   * conditionally without re-entering plugin replacement resolution.
   *
   * @experimental Audit before relying on this as a stable contract.
   */
  Original: ComponentType;
}

/**
 * Props passed to an `experimental_diffRenderer` component. `patch` is always
 * a complete single-file unified patch, whatever shape the caller supplied,
 * and optional full-file context is resolved to an object or `null`.
 */
export interface PluginDiffRendererProps {
  patch: string;
  path: string;
  view: DiffViewMode;
  overflow: CodeOverflowMode;
  showLineNumbers: boolean;
  /**
   * Caller-resolved text for both sides, or `null` when the caller supplied
   * only the patch. A replacement can use this to implement context expansion,
   * but must verify that the paths and hunk lines agree with `patch` before
   * treating the contents as complete. BB's original renderer performs that
   * verification when it mounts.
   */
  experimental_fullFileContents: ExperimentalDiffFullFileContents | null;
  /**
   * BB's diff renderer, bound to this request. Render it to delegate
   * conditionally without re-entering plugin replacement resolution.
   *
   * @experimental Audit before relying on this as a stable contract.
   */
  Original: ComponentType;
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
}

/**
 * Where a fenced code block stands while its message is written.
 *
 * - `"streaming"`: the closing delimiter has not arrived and the message is
 *   still being written; `code` is a prefix of the final body.
 * - `"closed"`: the closing delimiter is present; `code` is final.
 * - `"unclosed"`: the message ended without a closing delimiter (for example
 *   an interrupted reply); `code` will not grow.
 *
 * @experimental Audit before relying on this as a stable contract.
 */
export type ExperimentalCodeFenceStatus = "streaming" | "closed" | "unclosed";

/**
 * Props passed to an `experimental_codeFenceRenderer` component — one fenced
 * code block whose info-string language the plugin claimed, inside assistant
 * (or nested agent) message Markdown. BB mounts the component once per fence
 * and keeps that instance for as long as the message stays on screen, so
 * component state survives the whole stream, including the moment the fence
 * closes and the moment the reply finishes.
 *
 * @experimental Audit before relying on this as a stable contract.
 */
export interface ExperimentalCodeFenceRendererProps {
  /** The fence body received so far, without the fence delimiters. */
  code: string;
  /** The matched lowercase info-string language (e.g. `"ui"`). */
  language: string;
  status: ExperimentalCodeFenceStatus;
  /**
   * Zero-based ordinal of this fence among the fences of the same language in
   * the same message. It does not change while the message streams, so
   * `${message.id}#${language}#${index}` keys state that must outlive the
   * mounted component (a reload, or the message scrolling out of the rendered
   * window).
   */
  index: number;
  message: PluginMessageDirectiveMessage;
  /**
   * BB's own code block for this fence. Render it to show the source, for
   * example while `status` is `"streaming"` or when `code` does not parse.
   */
  Original: ComponentType;
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
  /** Render on Mobile settings instead of the plugin configuration page. */
  experimental_page?: "mobile";
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

/**
 * Render app-wide plugin UI outside BB's layout regions.
 *
 * The host mounts each registration once per app window through the ordinary
 * plugin React boundary. The component therefore keeps PluginContext, router,
 * query, realtime, and other app-level SDK contexts when it renders fixed UI
 * or creates a React portal. BB supplies no chrome, positioning, visibility,
 * or interaction policy; the plugin owns those details and responsive
 * behavior. Registrations are additive and a crash hides only that overlay.
 */
export interface ExperimentalAppOverlayRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  component: ComponentType<ExperimentalAppOverlayProps>;
}

/**
 * A name the host resolves to a glyph, in this order: a name any plugin
 * registered with `app.experimental_icons.register()`, then a built-in BB icon
 * name (`"Zap"`), then a namespaced `"<pluginId>/<name>"` glyph naming an
 * entry of that plugin's manifest `bb.branding.experimental_icons` map. A
 * registration therefore shadows a built-in, and either shadows a declared
 * icon of the same name. Names that resolve to none of the three fall back to
 * the surface's generic icon.
 *
 * Declared icons and registrations are one vocabulary here: the same name
 * works in `experimental_Icon`, in every field below, and — for a declared
 * icon — in the tool, provider and bridge-row declarations that accept one.
 * Declared icons need no frontend bundle and survive the plugin being stopped;
 * registrations can be any React component but live only while the plugin's
 * app bundle is loaded.
 */
type BbIconName = string;

/**
 * Owner-defined validator for a fixed tab's transient target. The host first
 * verifies that the value is JSON-safe, then calls this validator before
 * selecting the tab or delivering the target.
 */
export interface ExperimentalFixedTabTargetContract<Target extends JsonValue> {
  validate(value: JsonValue): value is Target;
}

/** Stable, owner-scoped reference used by the app-panel controller. */
export type ExperimentalPluginFixedTabReference<
  Target extends JsonValue = never,
> = {
  /** The owning `navPanel` id; validated against the containing registration. */
  readonly panelId: string;
  /** Unique within the owning nav panel; letters, digits, `-`, `_`. */
  readonly id: string;
} & ([Target] extends [never]
  ? {
      /** An untargeted tab cannot be opened with a target. */
      readonly experimental_target?: never;
    }
  : {
      /** Owner validation required before the host delivers a target. */
      readonly experimental_target: ExperimentalFixedTabTargetContract<Target>;
    });

/**
 * How urgent an {@link ExperimentalBadge} is. bb picks the colors: `neutral`
 * (the default) for counts and new items, `warning` for something due or
 * degraded, and `critical` for something failing or waiting on the user.
 *
 * Experimental: see docs/api_to_audit.md.
 */
export type ExperimentalBadgeTone = "neutral" | "warning" | "critical";

/**
 * A live value the host draws on a nav panel's navigation entry. Set at most
 * one of `count` and `text`; with neither, bb draws a dot.
 *
 * Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalBadge {
  /**
   * Positive integer drawn on the entry, shown as `9+` above 9 on the rail and
   * `99+` above 99 in lists.
   */
  count?: number;
  /**
   * A short visible value, at most 8 characters, such as "NEW", "73%", or
   * "3/5". Lists draw it; the icon-only rail draws a dot and puts `label` in
   * the tooltip.
   */
  text?: string;
  /** Defaults to `neutral`. */
  tone?: ExperimentalBadgeTone;
  /**
   * Text for the destination's tooltip and accessible name, such as
   * "3 open tasks". Required because the drawn badge is hidden from assistive
   * technology.
   */
  label: string;
}

export interface PluginNavPanelRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  /** Resolved names take precedence over plugin branding in navigation and the header; unknown names fall back to branding. */
  icon: BbIconName;
  /** URL segment under `/plugins/<pluginId>/`; letters, digits, `-`, `_`. */
  path: string;
  component: ComponentType<PluginNavPanelProps>;
  /**
   * Sidebar shown instead of the thread list while this panel's route is
   * active, in the same section sidebar as Settings, Plugins and Skills. BB
   * keeps the navigation rail, top chrome and resize handle; in the top-list
   * layout it adds a "Back to app" row and the panel title, and Back to app
   * (Escape) returns to the last app page. Receives the page's current
   * subPath. Other routes keep their usual sidebar. A crash shows a crash
   * notice until the subPath or plugin generation changes.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_sidebar?: ComponentType<PluginNavPanelProps>;
  /**
   * React hook evaluated in each pane's plugin scope with its current subPath.
   * Returns text after the panel icon/name and the focused pane's window title.
   * Null restores the default panel title. May use SDK hooks to load data.
   * A crash or invalid result clears the title without crashing the page;
   * navigation or plugin reload retries the hook. Experimental.
   */
  experimental_usePageTitle?: (
    props: PluginNavPanelProps,
  ) => ExperimentalPageTitle | null;
  /**
   * Optional React hook that returns this panel's navigation badge, or `null`
   * for none. The host calls it once in your plugin's scope for every
   * registered panel, including ones hidden under More, so it can own an RPC
   * query and realtime subscription through the ordinary SDK hooks. The value
   * reaches every navigation provider as the item's `badge`; bb's draw a
   * count or a dot on the entry, a dot on More while the panel is hidden
   * there, and `label` in the tooltip and accessible name. A hook that throws
   * or returns an invalid badge is treated as a crashed slot and shows no
   * badge.
   *
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useBadge?: () => ExperimentalBadge | null;
  /**
   * Optional component rendered on the right side of the shared title bar
   * (e.g. a sync button or a count). Contained separately from the body: a
   * throwing headerContent is hidden without breaking the title bar.
   */
  headerContent?: ComponentType<PluginNavPanelProps>;
}

/**
 * Context handed to a thread action tab's `run`.
 *
 * The action is thread-only and is never offered on the root New thread
 * screen, so `threadId` is always present.
 */
export interface ExperimentalThreadTabActionContext {
  /** The thread whose panel launcher invoked the action. */
  threadId: string;
  /** The side panel of the thread view that invoked the action. */
  experimental_panel: ExperimentalPanelController;
}

/** Where a plugin tab belongs. Navigation panels are owned by the registering plugin. */
export type ExperimentalTabContext =
  | { kind: "thread" }
  | { kind: "nav-panel"; panelId: string };

export interface ExperimentalTabReference {
  id: string;
  context: ExperimentalTabContext;
  availability: "fixed" | "action";
}

type ExperimentalTabCommon = ExperimentalTabReference & {
  title: string;
  icon: BbIconName;
  tooltip?: string;
  layout?: "padded" | "flush";
};

type ExperimentalTabLifecycle<Props, Context> =
  | {
      availability: "fixed";
      component: ComponentType<Props>;
      run?: never;
      params?: never;
    }
  | {
      availability: "action";
      component: ComponentType<Props & { params: JsonValue | null }>;
      /** Default persisted params when opened without explicit params. */
      params?: JsonValue;
      run?(
        context: Context & { experimental_panel: ExperimentalPanelController },
      ): void | Promise<void>;
    };

type ExperimentalTabContextProps<C extends ExperimentalTabContext> = C extends {
  kind: "thread";
}
  ? ExperimentalThreadTabProps
  : PluginNavPanelProps;

type ExperimentalTabInput<
  C extends ExperimentalTabContext,
  A extends "fixed" | "action",
> = {
  id: string;
  title: string;
  icon: BbIconName;
  tooltip?: string;
  layout?: "padded" | "flush";
  context: C;
  availability: A;
  useVisible?(props: ExperimentalTabContextProps<C>): boolean;
} & (A extends "fixed"
  ? {
      component: ComponentType<ExperimentalTabContextProps<C>>;
      run?: never;
      params?: never;
      experimental_target?: ExperimentalFixedTabTargetContract<JsonValue>;
    }
  : {
      component: ComponentType<
        ExperimentalTabContextProps<C> & { params: JsonValue | null }
      >;
      params?: JsonValue;
      run?(
        context: ExperimentalTabContextProps<C> & {
          experimental_panel: ExperimentalPanelController;
        },
      ): void | Promise<void>;
      experimental_target?: never;
    });

/** One registration for pinned destinations and actions opening closable instances. */
export type ExperimentalTabRegistration = ExperimentalTabCommon &
  (
    | ({
        context: { kind: "thread" };
        useVisible?(props: ExperimentalThreadTabProps): boolean;
      } & (
        | (ExperimentalTabLifecycle<
            ExperimentalThreadTabProps,
            ExperimentalThreadTabProps
          > & {
            availability: "action";
            experimental_target?: never;
          })
        | (ExperimentalTabLifecycle<
            ExperimentalThreadTabProps,
            ExperimentalThreadTabProps
          > & {
            availability: "fixed";
            experimental_target?: ExperimentalFixedTabTargetContract<JsonValue>;
          })
      ))
    | ({
        context: { kind: "nav-panel"; panelId: string };
        useVisible?(props: PluginNavPanelProps): boolean;
      } & (
        | (ExperimentalTabLifecycle<
            PluginNavPanelProps,
            PluginNavPanelProps
          > & {
            availability: "action";
            experimental_target?: never;
          })
        | (ExperimentalTabLifecycle<
            PluginNavPanelProps,
            PluginNavPanelProps
          > & {
            availability: "fixed";
            experimental_target?: ExperimentalFixedTabTargetContract<JsonValue>;
          })
      ))
  );

/** Context handed to an `experimental_newThreadPanelAction`'s `run`. */
export interface PluginNewThreadPanelActionContext {
  /** Project selected in the root composer; null in projectless compose. */
  projectId: string | null;
  /**
   * The New thread screen's side panel. Address this action's tab as
   * `{ id, context: { kind: "thread" }, availability: "action" }`.
   */
  experimental_panel: ExperimentalPanelController;
}

/** Registration for the root New thread screen's panel Actions list. */
export interface PluginNewThreadPanelActionRegistration {
  /** Unique within this slot for the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label of the action row in the panel's new-tab launcher. */
  title: string;
  /** Resolved names take precedence over plugin branding; omitted or unknown names fall back to branding. */
  icon?: BbIconName;
  /** Rendered inside every panel tab this action opens. */
  component: ComponentType<PluginNewThreadPanelProps>;
  /** Host framing; matches thread action tabs. */
  layout?: "padded" | "flush";
  /**
   * Runs when the user activates the action. Omitted = immediately open a
   * panel tab with defaults. Errors are contained and logged.
   */
  run?(context: PluginNewThreadPanelActionContext): void | Promise<void>;
}

export interface PluginPendingInteractionRegistration {
  /**
   * The renderer's plugin-local name. Two addresses resolve to it: the
   * `rendererId` a backend passes to `bb.ui.requestInput`, and the `<name>`
   * half of a provider bridge's `interaction/request` kind
   * `"<pluginId>/<name>"` (docs/provider-plugin-api.md §4), which the client
   * splits on the slash to find this registration under its plugin.
   * `bb.ui.requestInput` validates `rendererId` against `/^[a-zA-Z0-9_-]+$/`;
   * an extension kind must match `/^[a-z0-9-]+\/[a-z0-9-]+$/`
   * (`EXTENSION_KIND_PATTERN` in @bb/domain), so an id addressable both ways
   * uses lowercase letters, digits, and "-" only.
   */
  id: string;
  component: ComponentType<PluginPendingInteractionProps>;
}

/** Context handed to a `sidebarFooterAction`'s `run`. */
export interface PluginSidebarFooterActionContext {
  /**
   * Navigate to this plugin's detail page in Tools, where declarative settings
   * and `settingsSection` slots render.
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
  /** Resolved names take precedence over plugin branding; omitted or unknown names fall back to branding. */
  icon: BbIconName;
  /**
   * Runs when the user activates the action (e.g. call `openSettings()`,
   * open a panel via other surfaces, toast). Errors (sync or async) are
   * contained and logged; they never break the sidebar.
   */
  run(context: PluginSidebarFooterActionContext): void | Promise<void>;
}

/** Context handed to an experimental sidebar-footer action. */
export interface ExperimentalSidebarFooterActionContext {
  /** Navigate to this plugin's detail page in Tools. */
  openPluginDetails(): void;
}

/** Fields shared by both experimental sidebar-footer item behaviors. */
export interface ExperimentalSidebarFooterItemBase {
  /** Unique within the plugin's unified sidebar footer; letters, digits, `-`, `_`. */
  id: string;
  /** Tooltip and accessible label for the host-rendered icon button. */
  label: string;
  icon: BbIconName;
}

/** A sidebar-footer item that runs a callback when activated. */
export interface ExperimentalSidebarFooterActionRegistration extends ExperimentalSidebarFooterItemBase {
  kind: "action";
  onActivate(
    context: ExperimentalSidebarFooterActionContext,
  ): void | Promise<void>;
}

/** A sidebar-footer item that reveals plugin-rendered content above the row. */
export interface ExperimentalSidebarFooterDisclosureRegistration extends ExperimentalSidebarFooterItemBase {
  kind: "disclosure";
  component: ComponentType<ExperimentalSidebarFooterDisclosureProps>;
}

/** One host-rendered item in the app sidebar footer. */
export type ExperimentalSidebarFooterItemRegistration =
  | ExperimentalSidebarFooterActionRegistration
  | ExperimentalSidebarFooterDisclosureRegistration;

/** Live controls for an experimental sidebar-footer disclosure. */
export interface ExperimentalSidebarFooterDisclosureController {
  /** Request that the host open this disclosure, replacing any open sibling. */
  open(): void;
  /** Close this disclosure if it is currently open. */
  close(): void;
  /** Open this disclosure, or close it when it is currently open. */
  toggle(): void;
}

/** Managed registration surface for items in the app sidebar footer. */
export interface ExperimentalSidebarFooter {
  register(registration: ExperimentalSidebarFooterActionRegistration): void;
  register(
    registration: ExperimentalSidebarFooterDisclosureRegistration,
  ): ExperimentalSidebarFooterDisclosureController;
}

// ---------------------------------------------------------------------------
// Sidebar thread data (the `experimental_useSidebarThreads` contract).
// ---------------------------------------------------------------------------

/**
 * The one status bb would paint for a thread, already resolved through the
 * host's precedence (attention before work; plan and goal before the generic
 * spinner). Draw your own glyph for it — the SDK ships no status component.
 *
 * Treat an unrecognized value as "none": bb adds kinds over time, and an
 * older plugin must degrade to drawing nothing rather than throwing.
 *
 * "draft" and "working-draft" are never reported here: an unsubmitted composer
 * draft is per-client state the host reads per row, which an array-wide view
 * cannot. A thread holding a draft reports whatever it would report without
 * one. "queued-failed" and "queued-waiting" are reported, with the same
 * precedence bb's list uses (a failed send outranks the unread dot; a waiting
 * message ranks just below it).
 */
export type PluginSidebarThreadIndicator =
  | "unread-error"
  | "waiting-for-input"
  | "working-draft"
  | "workflow"
  | "background-agent"
  | "background-command"
  | "plan-mode"
  | "goal"
  | "runtime"
  | "queued-failed"
  | "draft"
  | "unread-success"
  | "queued-waiting"
  | "none";

/** Live work counts on a thread. All zero means nothing is running. */
export interface PluginSidebarThreadActivity {
  workflows: number;
  backgroundAgents: number;
  backgroundCommands: number;
  planMode: number;
  goals: number;
}

/**
 * One thread in the sidebar's live view.
 *
 * A deliberate copy of the fields a sidebar needs — not a re-export of the
 * host's internal thread row type, which changes whenever the app needs a
 * field. Timestamps are epoch milliseconds.
 */
export interface PluginSidebarThread {
  id: string;
  projectId: string;
  /** Null while a thread is still unnamed; pair with `titleFallback`. */
  title: string | null;
  titleFallback: string | null;
  /**
   * What bb shows for this thread as plain text: `title`, else
   * `titleFallback`, else a short id, with any `@project:`, `@section:`, and
   * `@thread:` mentions in it resolved to their names. Sort on it and use it
   * for accessible names; render {@link PluginSdkApp.ThreadTitle} for the
   * same text with mention chips.
   */
  displayTitle: string;
  /** The thread this one was forked from or spawned under; null at the root. */
  parentThreadId: string | null;
  /**
   * The thread whose lifecycle this one follows (a delegated child stops
   * when its owner stops); null when the thread owns its own lifecycle.
   */
  lifecycleOwnerThreadId: string | null;
  /** The thread this one was forked from; null unless `originKind` is "fork". */
  sourceThreadId: string | null;
  sectionId: string | null;
  /** How this thread came to exist under its parent; null for root threads. */
  originKind: "fork" | null;
  /** The plugin that spawned it, or null for non-plugin origins. */
  originPluginId: string | null;
  /** The agent provider this thread runs on; resolve it through
   * {@link PluginSdkApp.experimental_useProviders} for a name and icon. */
  providerId: string;

  /**
   * The thread's execution status. bb's list sorts busy threads ("starting",
   * "active", "stopping") above idle ones. Treat an unknown value as "idle".
   */
  status: ThreadStatus;
  /**
   * `status` refined by host and environment state: adds "provisioning" and
   * "waiting-for-host" for a thread whose machine is not ready. Treat an
   * unknown value as `status`.
   */
  runtimeStatus: ThreadRuntimeDisplayStatus;
  /**
   * Whether a message is queued behind the running turn ("waiting") or a
   * queued message failed to send ("failed"). "none" otherwise.
   */
  queuedWork: ThreadQueuedWork;
  /** The agent is blocked on the user: an approval or a question. */
  hasPendingInteraction: boolean;
  activity: PluginSidebarThreadActivity;
  indicator: PluginSidebarThreadIndicator;
  /**
   * The host's accessible label for `indicator`, e.g. "Thread needs user
   * input"; null when the indicator is "none". Use it for `aria-label` so
   * screen-reader text stays consistent across sidebars.
   */
  indicatorLabel: string | null;

  isUnread: boolean;
  isPinned: boolean;
  /** When the thread was pinned (epoch ms); null when unpinned. */
  pinnedAt: number | null;
  /**
   * The user's manual order among pinned threads (lexicographic, ascending);
   * null for an unpinned thread or a pin that has never been reordered, which
   * bb's list sorts after keyed pins by `pinnedAt`.
   */
  pinSortKey: string | null;
  isArchived: boolean;
  /** When the thread was archived (epoch ms); null when not archived. */
  archivedAt: number | null;
  /**
   * The app-relative URL bb opens for this thread, e.g.
   * `/projects/<projectId>/threads/<id>`. Put it on your row's anchor: the
   * host routes a plain click in place, and middle-click, copy-link, and
   * open-in-new-window work without further code.
   */
  href: string;
  /**
   * True for threads bb keeps out of its own list (internal helper threads a
   * plugin spawned with `visibility: "hidden"`). The array includes them so a
   * list that wants them can show them; bb's list filters them out.
   */
  isHidden: boolean;

  environment: {
    id: string | null;
    name: string | null;
    branchName: string | null;
    /** The checkout's absolute path on its host; null when unknown. */
    path: string | null;
    /**
     * True when the environment is a git worktree, which is what bb's
     * "group by environment" clusters; false for a plain checkout; null when
     * unknown.
     */
    isWorktree: boolean | null;
    /**
     * The id of the environment provider that produced this environment, or
     * null for a project's own checkout. Resolve it against
     * `GET /system/environment-providers` for a display name and icon.
     */
    providerId: string | null;
    /** @deprecated Use providerId and the environment provider catalog instead. */
    workspaceDisplayKind: EnvironmentWorkspaceDisplayKind | null;
  } | null;
  /**
   * The machine this thread's work runs on, with the name resolved for you.
   * Null when the thread has no environment yet, or when its host is not in
   * the known-hosts list. Useful where a thread has no branch to show — a
   * personal-project thread has a machine but no worktree.
   */
  host: { id: string; name: string } | null;

  createdAt: number;
  updatedAt: number;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

/** One project in the sidebar's live view. */
export interface PluginSidebarProject {
  id: string;
  name: string;
  /** True for the implicit personal project. */
  isPersonal: boolean;
  /** The app-relative URL of the project's compose screen. */
  href: string;
  /** The app-relative URL of the project's settings page. */
  settingsHref: string;
}

/**
 * One user-named thread section ("Later", "Slop Cop") in the sidebar's live
 * view. A thread belongs to at most one section via `sectionId`; a null
 * `sectionId` means the loose "Threads" bucket. Sections are created,
 * renamed, and deleted through the public API (`threadSections` in the SDK,
 * `bb thread section` in the CLI); this state is the read side.
 */
export interface PluginSidebarSection {
  id: string;
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

export interface PluginSidebarThreadsState {
  /** Null when archived threads were not requested. */
  experimental_archived: {
    status: "loading" | "ready" | "error";
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isFetchNextPageError: boolean;
    fetchNextPage(): Promise<void>;
  } | null;
  status: "loading" | "ready" | "error";
  threads: readonly PluginSidebarThread[];
  experimental_hosts?: readonly { id: string; name: string }[];
  projects: readonly PluginSidebarProject[];
  /** Every section, in the server's order (creation order). */
  sections: readonly PluginSidebarSection[];
}

/**
 * The provider directory (see {@link PluginSdkApp.experimental_useProviders}):
 * every registered agent provider in picker order, as the same `ProviderInfo`
 * the host's own pickers read. `logoUrl` is server-relative
 * (`/api/v1/system/providers/<id>/logo`) or null when the provider declared a
 * glyph or no icon; `strings` carries the provider's declared copy.
 */
export interface PluginProvidersState {
  status: "loading" | "ready" | "error";
  providers: readonly ProviderInfo[];
}

/**
 * One TextMate token rule from the active code theme, in the shape VS Code
 * theme files author it.
 */
export interface PluginCodeThemeTokenRule {
  /** Scope(s) the rule paints; absent means the theme's base rule. */
  scope?: string | readonly string[];
  settings: {
    /** `#rrggbb` or `#rrggbbaa`. */
    foreground?: string;
    background?: string;
    /** Space-separated TextMate font styles, e.g. `"bold italic"`. */
    fontStyle?: string;
  };
}

/**
 * The active code theme as a VS Code theme file: the same document BB's own
 * highlighter renders from, so a plugin that embeds a third-party editor can
 * translate it into that editor's theme format rather than guessing colors
 * from CSS variables.
 */
export interface PluginCodeThemeData {
  /** Registered theme name — a bundled Shiki name or a BB-registered id. */
  name: string;
  type: "light" | "dark";
  /** Default editor foreground, as `#rrggbb[aa]`. */
  fg: string;
  /** Default editor background, as `#rrggbb[aa]`. */
  bg: string;
  /** VS Code workbench colors (`editor.background`, `editorCursor.foreground`, …). */
  colors: Readonly<Record<string, string>>;
  tokenColors: readonly PluginCodeThemeTokenRule[];
}

/**
 * The code theme BB is currently rendering with (see
 * {@link PluginSdkApp.experimental_useCodeTheme}). `mode` and `name` change
 * the moment the user switches palette or light/dark; `theme` follows once
 * the theme file resolves, and keeps the previous document until then so a
 * consumer never has to paint an unthemed frame. Compare `theme.name` with
 * `name` to tell a settled state from one still resolving.
 */
export interface PluginCodeThemeState {
  mode: "light" | "dark";
  name: string;
  /** null only before the first theme file resolves. */
  theme: PluginCodeThemeData | null;
}

/**
 * What {@link PluginSdkApp.experimental_copyToClipboard} writes: plain text,
 * plus an HTML representation for paste targets that accept rich text.
 * Without `html`, only plain text is written.
 */
export interface ExperimentalClipboardContent {
  text: string;
  html?: string;
}

/**
 * What {@link PluginSdkApp.experimental_saveFile} saves: a URL on the bb
 * server (such as one of the plugin's own HTTP routes), or bytes already in
 * the page, plus the file name the user sees.
 */
export type ExperimentalSaveFileRequest =
  | { fileName: string; url: string }
  | { fileName: string; blob: Blob };

/**
 * How {@link PluginSdkApp.experimental_saveFile} started. `started` means
 * the browser or native shell took over the download; completion and share
 * cancellation are not reported to the page. `failed` means the download
 * could not start; bb already showed an error toast.
 */
export type ExperimentalSaveFileOutcome = "started" | "failed";

/**
 * The `threads` area of {@link PluginBrowserBbSdk}: bb's public thread API
 * with the calling plugin's identity filled in. `spawn` and `fork` stamp
 * `origin: "plugin"` and `originPluginId` unless the call names another
 * origin, and the plugin-metadata calls default `pluginId`. The same
 * narrowing the backend `bb.sdk` applies.
 */
export type PluginBoundThreadsArea = Omit<
  BbSdkAreas["threads"],
  | "getPluginMetadata"
  | "updatePluginMetadata"
  | "experimental_listPluginMetadata"
> & {
  getPluginMetadata(
    args: Omit<ThreadPluginMetadataArgs, "pluginId"> & { pluginId?: string },
  ): Promise<ThreadPluginMetadataResult>;
  experimental_listPluginMetadata(
    args: Omit<PluginThreadMetadataListArgs, "pluginId"> & {
      pluginId?: string;
    },
  ): Promise<PluginThreadMetadataListResult>;
  updatePluginMetadata(
    args: Omit<ThreadPluginMetadataUpdateArgs, "pluginId"> & {
      pluginId?: string;
    },
  ): Promise<ThreadPluginMetadataResult>;
};

/**
 * bb's public API client, bound to the calling plugin, for plugin frontends
 * (see {@link PluginSdkApp.useSdk}). The same areas the `bb` CLI and the
 * backend `bb.sdk` expose: threads, thread sections, projects, environments,
 * hosts, files, and the rest. Requests carry the signed-in user's session on
 * the app origin, so every call runs with the user's own authority; there
 * is no narrower plugin scope.
 */
export type PluginBrowserBbSdk = Omit<BbSdkAreas, "threads"> & {
  threads: PluginBoundThreadsArea;
};

/** Props for {@link PluginSdkApp.ThreadTitle}. */
export interface PluginThreadTitleProps {
  /** A thread in the sidebar's live view; renders nothing for an unknown id. */
  threadId: string;
}

/**
 * Props for {@link PluginSdkApp.experimental_ThreadStatusGlyph}: bb's thread
 * status glyph, the one its own lists draw. The caller resolves the
 * indicator, so a row can fold in state the host does not know about, such
 * as collapsed children or a client-local draft.
 */
export interface PluginThreadStatusGlyphProps {
  /** The indicator to draw; "none" draws nothing unless `rowStatus` shows. */
  indicator: PluginSidebarThreadIndicator;
  /** Draws the archive glyph instead of the indicator. */
  archived?: boolean;
  /**
   * A status another plugin set on the row (see
   * {@link PluginSdkApp.useSidebarThreadRowStatus}). It replaces every
   * indicator except "runtime", "unread-error", and "waiting-for-input".
   */
  rowStatus?: PluginSidebarThreadRowStatus | null;
  /** Hides the idle draft glyph from assistive technology. */
  hideIdleDraftLabel?: boolean;
  /** "compact" draws a 14 px glyph; "default" matches bb's sidebar rows. */
  size?: "default" | "compact";
}

/**
 * One environment provider from bb's catalog (see
 * {@link PluginSdkApp.useEnvironmentProviders}): what a sidebar needs to
 * name and draw the environment a thread runs in. `icon` and `logoUrl` are
 * what `experimental_ProviderIcon` reads with `providerKind: "environment"`.
 */
export interface PluginEnvironmentProvider {
  id: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  logoUrl: string | null;
  /** The plugin that registered the provider. */
  pluginId: string;
  /** The machine provider it runs on, or null for the local machine. */
  machineProviderId: string | null;
}

export interface PluginEnvironmentProvidersState {
  status: "loading" | "ready" | "error";
  providers: readonly PluginEnvironmentProvider[];
}

/**
 * Whether the composer holds unsent text for a thread (see
 * {@link PluginSdkApp.useSidebarThreadDraft}). This is per-client state, so
 * it lives beside `indicator` rather than in it: bb's row paints a pencil for
 * an idle thread with a draft and a "working-draft" glyph for a busy one.
 */
export interface PluginSidebarThreadDraftState {
  hasUnsubmittedDraft: boolean;
}

/**
 * The status another plugin's app-wide script set on a thread's row through
 * the content-script context's `experimental_setThreadRowStatus` (see
 * {@link PluginSdkApp.useSidebarThreadRowStatus}). bb's row draws it in
 * place of the draft glyph while it is set; a replaced list should do the
 * same so a status set by, say, the drafts or workflows plugin does not
 * vanish when the list changes hands.
 */
export type PluginSidebarThreadRowStatus = PluginComposerThreadRowStatus;

/**
 * The jump-to-thread shortcut bb assigned to a row while the app command
 * modifier is held (see {@link PluginSdkApp.useSidebarThreadShortcut}).
 */
export interface PluginSidebarThreadShortcut {
  /** Human-readable key label, e.g. "⌘1", for a pill on the row. */
  label: string;
  /** Value for the row's `aria-keyshortcuts` attribute. */
  ariaKeyshortcuts: string;
}

/**
 * Act on threads from a plugin surface. Every method routes to the host's own
 * flow, so optimistic updates, toasts, dialogs, pane closing, and route repair
 * behave exactly as they do in the built-in sidebar. Unknown thread ids are
 * ignored by `open` and rejected by the rest.
 *
 * @internal Superseded by `app.slots.experimental_threadAction` and
 * `experimental_ThreadActionsMenu`, `useSdk().threads` for data writes, and
 * `useBbNavigate().toThread` / `toCompose` for navigation; kept for plugins
 * built against older SDKs.
 */
export interface PluginSidebarThreadActions {
  /**
   * Navigate to a thread. `split: true` applies bb's split placement rules —
   * a right split by default, focus when the thread is already open, replace
   * at the pane cap — and falls back to plain navigation where splits are off.
   * Opening also expands the thread's conversation if the secondary panel had
   * collapsed it, as bb's own row does.
   */
  open(threadId: string, options?: { split?: boolean }): void;
  /**
   * Go to the new-thread screen. Passing `projectId` also makes that project
   * the composer's selection, so the thread is created where you asked.
   * `sectionId` files the new thread under that section, and
   * `environmentId` reuses that environment (the "New thread in
   * environment" affordance), both exactly as bb's own list does.
   * `experimental_placement` explicitly selects the section and pin state,
   * overriding `sectionId`. Omitting placement starts unpinned, outside sections
   * unless `sectionId` is supplied; previous composer placement is cleared.
   * `hostId` selects a machine for a new environment when it
   * is known and supports an environment provider. `environmentId` wins when
   * both are supplied.
   */
  openNewThread(options?: {
    projectId?: string;
    sectionId?: string;
    experimental_placement?: { sectionId: string | null; pinned: boolean };
    environmentId?: string;
    hostId?: string;
    focusPrompt?: boolean;
  }): void;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  setRead(threadId: string, read: boolean): Promise<void>;
  /** Silent rename — no dialog. For inline editing in your own row. */
  rename(threadId: string, title: string): Promise<void>;
  /** Confirms before including child threads unless archive confirmation is disabled in Settings → General. */
  archive(threadId: string): void;
  /** Archives an environment's active thread trees with bb's optimistic updates, pane cleanup, and one Undo toast. Rejects after bb shows an error toast on failure. */
  experimental_archiveEnvironmentThreads(environmentId: string): Promise<void>;
  /**
   * Opens bb's delete confirmation, which counts child threads first. Deletion
   * is destructive and recursive, so the host owns the confirmation: there is
   * deliberately no silent `delete`.
   */
  requestDelete(threadId: string): void;
}

/**
 * Props passed to an `experimental_threadRowMetadata` component, rendered on a
 * thread's row in a thread list: bb's sidebar and any list that draws
 * {@link PluginSdkApp.experimental_ThreadRowMetadata}.
 */
export interface ExperimentalThreadRowMetadataProps<Data = undefined> {
  /** The row's thread, the same value the list renders. */
  thread: PluginSidebarThread;
  /** What `useData` last returned; undefined when the registration has none. */
  data: Data;
}

/** What a row metadata registration's `useData` receives. */
export interface ExperimentalThreadRowMetadataDataInput {
  /**
   * Every thread a list may draw a metadata line for: bb's active sidebar
   * threads in sidebar order, then any other thread whose line is mounted
   * (such as an archived row), deduplicated. Threads whose rows are not
   * rendered, like a windowed list's rows off screen, are included: load
   * them all in one batch so a row has its data, and its final height, when
   * it renders.
   */
  threads: readonly PluginSidebarThread[];
}

/**
 * A small item on a thread row's metadata line, under the title: a badge, not
 * a control. Items share one line, left to right, and the line clips at the
 * row's edge. bb's sidebar draws the line only while the `threadRowMetadata`
 * experiment is on and the user turns on Organize → Rows → Metadata, and only
 * on rows where an item shows something.
 * Load the line's data in `useData`, a React hook bb calls once for the
 * whole app while any list draws a metadata line, never per row; it
 * receives every thread a list may show, so read them in one batch (for
 * example one `experimental_useRpcKeyedQuery` over their keys). The
 * component is then a pure render of its thread and `data`; with `useData`
 * it first renders once `useData` has returned. A row that renders already
 * has its data, so rows keep their height as they scroll into view.
 * It hides the line while the row is renamed or customized and keeps it
 * visible on hover. Render null to show nothing for a thread. Keep
 * it to an icon and a few characters with a tooltip; clicks on it open the
 * thread like the rest of the row. A crash removes only this item for that
 * row.
 */
export interface ExperimentalThreadRowMetadataRegistration<Data = undefined> {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /**
   * Items sort by `order` (unset sorts last), then registration order. The
   * first item starts the line.
   */
  order?: number;
  useData?(input: ExperimentalThreadRowMetadataDataInput): Data;
  component: ComponentType<ExperimentalThreadRowMetadataProps<Data>>;
}

/** Props for {@link PluginSdkApp.experimental_ThreadRowMetadata}. */
export interface ExperimentalThreadRowMetadataLineProps {
  thread: PluginSidebarThread;
}

/**
 * Props passed to an `experimental_threadInfoRow` or
 * `experimental_threadInfoSection` component, rendered in a thread's Info tab.
 */
export interface ExperimentalThreadInfoProps {
  /**
   * The thread whose Info tab is open. A split layout renders one Info tab per
   * pane, so the component mounts once per visible thread; keep per-thread
   * state in the component, never in a module-level singleton.
   */
  threadId: string;
  projectId: string;
  /**
   * The thread's environment, taken from the thread; null only when the
   * thread has no environment. Read its state (host, checkout, git) yourself.
   */
  environment: ExperimentalThreadEnvironment | null;
}

/** An environment a thread surface hands to plugin components. */
export interface ExperimentalThreadEnvironment {
  id: string;
}

/**
 * A visible thread context segment. `key` is `<pluginId>/<id>`, where bb's own
 * segments use `bb--core`, as thread action keys do.
 */
export interface ExperimentalThreadContextSegmentReference {
  key: string;
  pluginId: string;
}

/** What a thread context segment knows about its thread. */
export interface ExperimentalThreadContextSegmentInput {
  threadId: string;
  projectId: string;
  /**
   * The thread's environment, or null when the thread has no environment,
   * its host is not active, or the environment is not a usable checkout.
   */
  environment: ExperimentalThreadEnvironment | null;
}

/** Props of a thread context segment's `summary`, `action` and `details`. */
export interface ExperimentalThreadContextSegmentProps extends ExperimentalThreadContextSegmentInput {
  /** The visible segments in row order, this one included. */
  segments: readonly ExperimentalThreadContextSegmentReference[];
  /** One segment of a thread's context row is expanded at a time. */
  isExpanded: boolean;
  onToggle(): void;
}

/**
 * A segment of the context row above an existing thread's composer. bb's
 * parent thread and changed files register through this slot too. The host
 * mounts each component in its own crash boundary.
 */
export interface ExperimentalThreadContextSegmentRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Accessible name of the group the host wraps around `summary`. */
  title: string;
  /**
   * Segments sort by `group` (string compare), then by `order` within a group
   * (unset sorts last), then by registration order, with bb's own first on a
   * tie. bb's groups are
   * {@link PluginSdkApp.experimental_THREAD_CONTEXT_SEGMENT_GROUPS}; any other
   * string is a group of its own, placed where it sorts.
   */
  group: string;
  order?: number;
  /** Renders in the context row. */
  summary: ComponentType<ExperimentalThreadContextSegmentProps>;
  /** Renders at the row's end, after every segment's summary. */
  action?: ComponentType<ExperimentalThreadContextSegmentProps>;
  /** Renders below the row; show content only while `isExpanded`. */
  details?: ComponentType<ExperimentalThreadContextSegmentProps>;
  /**
   * Runs in plugin scope for each thread; false hides the segment and leaves
   * it out of `segments`. Omit to always show.
   */
  useVisible?(input: ExperimentalThreadContextSegmentInput): boolean;
}

/**
 * A row in the thread Info tab's details block, beside bb's own rows. Render
 * one or more `experimental_DetailRow` elements, or null to show nothing for
 * this thread. A crash removes only this row for that thread.
 */
export interface ExperimentalThreadInfoRowRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /**
   * Rows sort by `group` (string compare), then by `order` within a group
   * (unset sorts last), then by registration order, with bb's own rows first
   * on a tie. bb's groups are
   * {@link PluginSdkApp.experimental_THREAD_INFO_ROW_GROUPS}; any other
   * string is a group of its own, placed where it sorts. Groups only order
   * rows; the details block draws no separator between them.
   */
  group: string;
  order?: number;
  component: ComponentType<ExperimentalThreadInfoProps>;
}

/**
 * A section in the thread Info tab, below the details block. Render one
 * `experimental_InfoSection`, or null to hide the section for this thread.
 * The host remembers the section's collapsed state per registration. A crash
 * removes only this section for that thread.
 */
export interface ExperimentalThreadInfoSectionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /**
   * Sections sort by `group` (string compare), then by `order` within a group
   * (unset sorts last), then by registration order, with bb's own sections
   * first on a tie. bb's groups are
   * {@link PluginSdkApp.experimental_THREAD_INFO_SECTION_GROUPS}; any other
   * string is a group of its own, placed where it sorts.
   */
  group: string;
  order?: number;
  component: ComponentType<ExperimentalThreadInfoProps>;
}

/**
 * Props of the host-owned `experimental_InfoSection` component — the heading,
 * count, and collapse control every Info tab section uses.
 */
export interface ExperimentalInfoSectionProps {
  label: string;
  /** Drawn as a pill after the label; omit for no count. */
  count?: number;
  /** Drawn after the label and count while the section is expanded. */
  accessory?: ReactNode;
  /** Drawn at the heading's trailing edge while the section is expanded. */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * Props of the host-owned `experimental_DetailRow` component — one label and
 * value pair in the Info tab's details block.
 */
export interface ExperimentalDetailRowProps {
  label: ReactNode;
  /** Icon drawn before the label, any name `experimental_Icon` accepts. */
  icon?: BbIconName;
  /** Vertical alignment of label and value; defaults to `center`. */
  align?: "center" | "start";
  children: ReactNode;
}

/**
 * Props of the host-owned `experimental_InfoList` component — the list every
 * Info tab section uses, collapsed to `limit` rows behind a "N more" toggle.
 */
export interface ExperimentalInfoListProps<Item> {
  items: readonly Item[];
  getKey(item: Item): string;
  /** Usually an `experimental_InfoListRow`. */
  renderItem(item: Item): ReactNode;
  /** Rows shown before the "N more" toggle; defaults to 5. */
  limit?: number;
}

/**
 * Props of the host-owned `experimental_InfoListRow` component — one row of an
 * `experimental_InfoList`.
 */
export interface ExperimentalInfoListRowProps {
  /** Drawn in the row's 12px leading column, such as an `experimental_Icon`. */
  leading: ReactNode;
  /** Tooltip and accessible name for `leading`; omit when it is decorative. */
  leadingLabel?: string;
  name: ReactNode;
  /** Native tooltip on the name. */
  title?: string;
  /** Muted text after the name, truncated from the start. */
  context?: string;
  /** Drawn at the row's trailing edge, such as a status. */
  trailing?: ReactNode;
  /** Runs when the user activates the row; omit for a static row. */
  onSelect?: () => void;
}

export interface ExperimentalPluginBrowserToolbarActionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Accessible name for the host-wrapped control group. */
  title: string;
  /** Component rendered beside the Browser address bar. */
  component: ComponentType<ExperimentalPluginBrowserToolbarActionProps>;
}

/**
 * The thread a thread action is evaluated for: the fields bb's own actions
 * read, copied from the thread payload by the surface that shows the menu.
 */
export interface PluginThreadActionTarget {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  archivedAt: number | null;
  pinnedAt: number | null;
  sectionId: string | null;
  isUnread: boolean;
  status: ThreadStatus;
  /**
   * The thread's environment when a new thread can reuse it, null otherwise.
   * `path` is the checkout path, null when the environment has none.
   */
  environment: { id: string; path: string | null } | null;
}

/** One row of a thread action's choice list. */
export interface PluginThreadActionChoice {
  id: string;
  label: string;
  icon?: BbIconName;
  selected?: boolean;
  disabled?: boolean;
}

/**
 * A choice list instead of a direct action: a submenu in desktop menus, a step
 * with Back in the compact drawer, and a popover from a row's quick-action
 * button. `run` receives the picked choice's `id` as `value`.
 */
export interface PluginThreadActionChoices {
  /**
   * Title of the drawer step and the quick-action popover; defaults to the
   * action's label. Desktop submenus show none: their trigger names them.
   */
  heading?: string;
  /** Footnote below the choices, e.g. why the current value differs from the pick. */
  hint?: string;
  items: readonly PluginThreadActionChoice[];
}

/** What a thread action's `run` receives. */
export interface PluginThreadActionRunInput {
  /** The picked choice's `id` when the action has `choices`; otherwise undefined. */
  value?: string;
  /**
   * Start renaming a thread with the editor of the surface that showed the
   * menu: inline in the sidebar row or thread header, bb's rename dialog
   * elsewhere.
   */
  requestRename(threadId: string): void;
}

/** One evaluated thread action: what a registration shows for one thread. */
export interface PluginThreadAction {
  label: string;
  /**
   * Short secondary text, e.g. the current value of a choice list. Shown on
   * a muted second line under the label, except on rows with `choices`,
   * where only tooltips and screen readers include it.
   */
  detail?: string;
  icon: BbIconName;
  variant?: "default" | "destructive";
  disabled?: boolean;
  choices?: PluginThreadActionChoices;
  /**
   * Runs when the user activates the action or picks a choice. Errors (sync
   * or async) are contained and logged; they never break the menu.
   */
  run(input: PluginThreadActionRunInput): void | Promise<void>;
}

/** What a registration's `useData` receives. */
export interface PluginThreadActionDataInput {
  /**
   * Every thread a visible surface currently shows actions for (sidebar rows
   * on screen, the open thread's header, open menus); a hidden sidebar
   * contributes none. A `"header"` action receives only the threads whose
   * header is on screen. Sorted, deduplicated, and published once the set has
   * been quiet for 32 ms (at most 100 ms after the first change), so rows
   * that mount a frame apart arrive together. Load per-thread state for these
   * ids, fetching only ids not loaded yet.
   */
  threadIds: readonly string[];
}

/** What a registration's `item` receives for each thread it is shown for. */
export interface PluginThreadActionItemInput<Data> {
  thread: PluginThreadActionTarget;
  /** What `useData` last returned; undefined when the registration has none. */
  data: Data;
  /** The registering plugin's `useSdk()` client. */
  sdk: PluginBrowserBbSdk;
  /** The registering plugin's `useBbNavigate()`. */
  navigate: BbNavigate;
  /**
   * The focused surface's side panel, as for plugin commands. Thread menus
   * are not inside a side panel, so calls return false when the focused
   * surface has no such tab.
   */
  experimental_panel: ExperimentalPanelController;
}

/**
 * What a registration's `experimental_bulkItem` receives for a selection
 * of several threads.
 */
export interface PluginThreadActionBulkItemInput<Data> {
  /** The selected threads in the surface's list order; always two or more. */
  threads: readonly PluginThreadActionTarget[];
  /** What `useData` last returned; undefined when the registration has none. */
  data: Data;
  /** The registering plugin's `useSdk()` client. */
  sdk: PluginBrowserBbSdk;
  /** The registering plugin's `useBbNavigate()`, as for `item`. */
  navigate: BbNavigate;
  /** The focused surface's side panel, as for `item`. */
  experimental_panel: ExperimentalPanelController;
}

/**
 * Add an action to every thread actions menu: the thread header's menu, the
 * sidebar row's menu and right-click menu, the compact long-press drawer, and,
 * when the user picks it, a sidebar row's quick-action buttons. bb's own
 * actions (Open in split, Copy link, Mark read, Pin, Rename, Archive,
 * Delete, …) are registrations of this same shape.
 *
 * `useData` is a React hook the host calls once for the whole app, never per
 * thread or per menu; read app-wide state there (preferences, a realtime
 * channel, per-thread state for the `threadIds` it receives, fetched in one
 * batch for the ids not loaded yet). `item` is pure and synchronous: it
 * derives the action for one thread from that thread and `data`, closing over
 * everything `run` needs, or returns null to hide it. A throw from either
 * drops only this registration.
 *
 * With `placement: "header"` the action is a button in the open thread's
 * header instead (see {@link PluginThreadActionPlacement}).
 */
export interface PluginThreadActionRegistration<Data = undefined> {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Static name, shown where the user picks a row's quick actions. */
  title: string;
  /** Static icon for that picker; the evaluated action's `icon` wins in menus. */
  icon: BbIconName;
  /**
   * Menus and the quick-action picker sort by `group` (string compare) with a
   * separator between groups, then by `order` within a group (unset sorts
   * last), then by registration order. bb's groups are
   * {@link PluginSdkApp.experimental_THREAD_ACTION_GROUPS}; any other string
   * is a group of its own, placed where it sorts.
   */
  group: string;
  order?: number;
  /** Where the action shows; defaults to `"menu"`. */
  placement?: PluginThreadActionPlacement;
  useData?(input: PluginThreadActionDataInput): Data;
  item(input: PluginThreadActionItemInput<Data>): PluginThreadAction | null;
  /**
   * The action for several selected threads at once, shown when
   * `experimental_ThreadActionsContextMenu` gets an `experimental_bulkThreads`
   * (see {@link PluginThreadActionsContextMenuProps}). Pure and
   * synchronous like `item`, with every selected thread in `useData`'s
   * `threadIds`; `run` acts on all of them. Omit it, or return null, to leave
   * the action out of selection menus. Experimental: see docs/api_to_audit.md.
   */
  experimental_bulkItem?(
    input: PluginThreadActionBulkItemInput<Data>,
  ): PluginThreadAction | null;
}

/**
 * Where a thread action shows.
 *
 * - `"menu"`: every thread actions menu and the quick-action picker.
 * - `"header"`: only the open thread's header, as an outline button labelled
 *   with the action's `label`, after the workspace's Open button. Several
 *   header actions share one split button, the first as its main action. At
 *   compact width and in narrow split panes the buttons fold into the
 *   header's thread menu as rows at its top, after Open. `group` and `order`
 *   sort header actions among themselves. Header actions never appear in
 *   other menus, selection menus, `experimental_useThreadActions`, or the
 *   quick-action picker, and an action that returns `choices` is left out
 *   of the header.
 */
export type PluginThreadActionPlacement = "menu" | "header";

/**
 * A thread action as {@link PluginSdkApp.experimental_useThreadActions}
 * returns it: `run` is bound to the caller's `requestRename` (or bb's rename
 * dialog), contains errors, and resolves when the action settles.
 */
export interface PluginBoundThreadAction extends Omit<
  PluginThreadAction,
  "run"
> {
  /** `value` is the picked choice's `id` for an action with `choices`. */
  run(value?: string): Promise<void>;
}

/**
 * One row of {@link PluginSdkApp.experimental_useThreadActions}: `key` is
 * `<owner>/<id>`, where the owner is the registering plugin's id or
 * `bb--core` for bb's own actions.
 */
export interface PluginThreadActionEntry {
  key: string;
  pluginId: string;
  /** The registration's group, for separators in a caller's own list. */
  group: string;
  action: PluginBoundThreadAction;
}

/** One row of {@link PluginSdkApp.experimental_useThreadActionRegistrations}. */
export interface PluginThreadActionRegistrationInfo {
  key: string;
  pluginId: string;
  title: string;
  icon: BbIconName;
}

/** Options for {@link PluginSdkApp.experimental_useThreadActions}. */
export interface PluginThreadActionsOptions {
  /** Return only these keys, in this order. Omit for every action in menu order. */
  keys?: readonly string[];
  /**
   * The surface's own rename editor, passed to `run` as `requestRename`.
   * Omit to use bb's rename dialog.
   */
  requestRename?(threadId: string): void;
}

/**
 * An action a surface adds to its own copy of the thread menu, not a
 * registration: appended to the end of its `group`. `key` must be unique in
 * the menu.
 */
export interface PluginThreadActionsInlineItem {
  key: string;
  group: string;
  action: PluginThreadAction;
}

/**
 * What a thread menu's `trigger` receives: the menu's ARIA state, event
 * handlers, and ref. Spread all of them onto the button you render (compose
 * your own handlers after calling theirs); a trigger that drops them never
 * opens the menu.
 */
export type PluginThreadActionsTriggerProps = ComponentPropsWithRef<"button">;

interface PluginThreadActionsMenuBaseProps {
  thread: PluginThreadActionTarget;
  inline?: readonly PluginThreadActionsInlineItem[];
  /** See {@link PluginThreadActionsOptions.requestRename}. */
  requestRename?(threadId: string): void;
  onOpenChange?(open: boolean): void;
  /** Radix's close auto-focus hook, to restore focus to the surface's own control. */
  onCloseAutoFocus?(event: Event): void;
}

/**
 * Props of the host-owned `experimental_ThreadActionsMenu`: bb's thread menu
 * opened from the button `trigger` renders (see
 * {@link PluginThreadActionsTriggerProps}), a drawer at compact width.
 */
export interface PluginThreadActionsMenuProps extends PluginThreadActionsMenuBaseProps {
  trigger(props: PluginThreadActionsTriggerProps): ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

/**
 * Props of the host-owned `experimental_ThreadActionsContextMenu`: bb's thread
 * menu on right-click of `children`, or on touch long-press at compact width.
 */
export interface PluginThreadActionsContextMenuProps extends PluginThreadActionsMenuBaseProps {
  children: ReactNode;
  /** Suppresses the menu, e.g. while the row edits its title. */
  disabled?: boolean;
  /** Closes the menu and suppresses opening while the row is being dragged. */
  dragging?: boolean;
  /**
   * The selected threads in list order when the row is part of a multi-row
   * selection. With two or more, the menu acts on all of them: it lists every
   * registration's `experimental_bulkItem` under a count of the
   * selection, including bb's own Mark read, Pin, Archive and Delete, which
   * confirm and clean up as the single-thread actions do, then `inline`.
   * Omit it, or pass fewer than two, for `thread`'s own menu. Experimental:
   * see docs/api_to_audit.md.
   */
  experimental_bulkThreads?: readonly PluginThreadActionTarget[];
  /** Called when Escape dismisses the desktop menu, e.g. to clear a selection. */
  onEscapeKeyDown?(event: KeyboardEvent): void;
}

/** One pane's place in the split layout, as fractions of the split area. */
export interface PluginSidebarSplitPane {
  paneId: string;
  rect: { x: number; y: number; width: number; height: number };
  /** This pane holds the thread the row represents. */
  isMe: boolean;
  isFocused: boolean;
}

/**
 * The whole split layout (see {@link PluginSdkApp.useSidebarSplitLayout}):
 * every pane with its rect as fractions of the split area and the thread it
 * shows, or null when there is no split (a single pane, a compact viewport,
 * or splits disabled). Use it for group rollups, a collapsed section that
 * should show where its threads are open; a row wants
 * `experimental_useSidebarThreadSplit` instead.
 */
export interface PluginSidebarSplitLayout {
  panes: readonly {
    paneId: string;
    rect: { x: number; y: number; width: number; height: number };
    /** The thread this pane shows, or null for non-thread content. */
    threadId: string | null;
    isFocused: boolean;
  }[];
}

/** Options for {@link PluginSdkApp.experimental_useSidebarThreadSplit}. */
export interface PluginSidebarThreadSplitOptions {
  /**
   * Every thread a drag from this row carries, in list order, when the row is
   * part of a multi-row selection; include the row's own thread. With more
   * than one thread the drag offers no split or replace targets and drops
   * onto a composer as one mention per thread. Omit for a single-row drag.
   */
  dragThreadIds?: readonly string[];
}

/**
 * Drag-to-split support for one row, plus where that thread currently sits in
 * the split layout.
 */
export interface PluginSidebarThreadSplit {
  /**
   * Spread onto the row's interactive element. Carries the pointer handler
   * that starts a split drag; empty when splits are unavailable, so spreading
   * it is always safe.
   *
   * The host owns every rule: the gesture engages only once the pointer leaves
   * the sidebar toward the main area (so a list with its own drag-to-reorder
   * keeps working), an edge drop splits, a center drop replaces, an
   * already-open thread focuses its pane, and the pane cap coerces a split
   * into a replace.
   */
  splitProps: {
    onPointerDown?: (event: import("react").PointerEvent<HTMLElement>) => void;
  };
  /**
   * False on compact viewports, when the user disabled splits, and for an
   * unknown thread id. Gate any "open in split" affordance you draw on it.
   */
  isAvailable: boolean;
  /**
   * Where this thread sits in the split layout, or null when it is not open in
   * one (including single-pane layouts). Draw a mini-map, a tint, or nothing.
   */
  layout: { panes: readonly PluginSidebarSplitPane[] } | null;
}

/**
 * Replace the sidebar's thread list with a plugin component.
 *
 * Unlike every other slot, this one is EXCLUSIVE: two lists cannot share one
 * scroll area. bb ships its own list as the bundled Thread list plugin
 * (`thread-list/thread-list`). Registering activates the replacement while the
 * plugin is enabled: by default the first registered list other than the
 * bundled one, in deterministic slot order, is active, falling back to the
 * bundled list; removing it reveals the next. The user can pin a specific
 * provider, including the bundled one, under Settings → Appearance → Sidebar.
 * A missing pinned provider or a crashing list shows a placeholder rather than
 * leaving the user with no sidebar.
 *
 * The plugin gets the scrolling list and nothing else. The New-thread button,
 * the search action, the plugin nav rows, and the footer stay host-rendered in
 * every sidebar — they are shared surfaces (other plugins live in two of
 * them), and a replaced list must not be able to remove them.
 */
export interface PluginThreadListRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label shown in Settings → Appearance and capability details. */
  title: string;
  /** Optional one-line description shown with the provider choice. */
  description?: string;
  component: ComponentType<PluginThreadListProps>;
}

/**
 * Draw the sidebar's navigation: New thread, Plugins, Skills, Automations,
 * plugin panels, and More, plus optional controls in the sidebar header.
 * Exclusive: bb's bundled Navigation plugin registers Rail
 * (`navigation/rail`, the default) and Top list (`navigation/top-list`)
 * through this slot. By default the first provider from another plugin is
 * active, falling back to Rail; the user can pin one provider under Settings →
 * Appearance → Navigation. A pinned provider that is disabled or removed falls
 * back the same way, and a crashing provider is replaced by the Navigation
 * plugin's provider for the same placement.
 *
 * `placement` decides the layout around the component, so bb can lay out the
 * sidebar before the plugin loads:
 *
 * - `rail`: a fixed-width column on the sidebar's left edge that stays when
 *   the sidebar collapses. bb draws Settings at the bottom of the column;
 *   draw Home with `actions.goHome({ target })`. On macOS, wide windows
 *   frame the sidebar and page below a title bar.
 * - `list` (the default): the area above the thread list. Settings is a
 *   footer action, the Settings, Plugins, and Skills lists start with a Back
 *   to app row, and collapsing hides the whole sidebar.
 *
 * Draw New thread yourself, in `component` or `headerComponent`. bb's Rail
 * puts it in its header; Top list draws it as a row.
 */
export interface ExperimentalSidebarNavigationRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label shown in Settings → Appearance and capability details. */
  title: string;
  /** Optional one-line description shown with the provider choice. */
  description?: string;
  placement?: ExperimentalSidebarNavigationPlacement;
  component: ComponentType<ExperimentalSidebarNavigationProps>;
  /**
   * Rendered in the sidebar's header row while this navigation is active,
   * between the sidebar toggle and bb's back and forward buttons. Content is
   * clipped to the row, so it cannot move the thread list or bb's controls.
   * On macOS the empty space keeps dragging the window; buttons, links, and
   * inputs do not. A crashing header is replaced by the header of the
   * bundled Navigation plugin's provider for the same placement.
   */
  headerComponent?: ComponentType<ExperimentalSidebarHeaderProps>;
}

/**
 * Register this plugin as a viewer/editor for file extensions. By default,
 * matching files render the first applicable opener in deterministic slot
 * order. The user can pin BB's preview or a specific opener per extension
 * under Settings → Files. The file tab's "Open with" menu can override that
 * choice for one open. A plugin can also use its own setting and render
 * `Original` conditionally. Applies to working-tree, host, and
 * thread-storage files — never to git-ref snapshots (diff views always use
 * BB's preview).
 */
export interface PluginFileOpenerRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label in the "Open with" menu (e.g. "Notes editor"). */
  title: string;
  /** Lowercase alphanumeric extensions without the dot; single underscores or hyphens may separate segments. */
  extensions: readonly string[];
  component: ComponentType<PluginFileOpenerProps>;
}

/**
 * Replace BB's source-code renderer everywhere it renders supplied source
 * text — the native file preview and every plugin that calls
 * `experimental_SourceCode`. Like `experimental_threadList` this slot is
 * **exclusive**: one renderer at a time. Registering activates it while the
 * plugin is enabled; if several are registered, one from a plugin the user
 * installed wins over one bundled with bb, then the first in deterministic
 * slot order. A missing, disabled, or crashing replacement falls back to BB's
 * renderer, and a replacement can render `Original` to delegate
 * per call (behind its own setting, by language, by size — whatever it needs).
 */
export interface PluginSourceCodeRendererRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label shown in capability details. */
  title: string;
  /** Optional one-line description shown with the provider choice. */
  description?: string;
  component: ComponentType<PluginSourceCodeRendererProps>;
}

/**
 * Replace BB's diff renderer everywhere it renders supplied diff content — the
 * timeline file diffs, the environment diff panel's text bodies, and every
 * plugin that calls `experimental_Diff`. Exclusive, with the same activation,
 * fallback, and `Original` delegation rules as
 * {@link PluginSourceCodeRendererRegistration}.
 */
export interface PluginDiffRendererRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label shown in capability details. */
  title: string;
  /** Optional one-line description shown with the provider choice. */
  description?: string;
  component: ComponentType<PluginDiffRendererProps>;
}

/**
 * Props passed to an `experimental_composer` component. Deliberately empty:
 * the component reads everything through `experimental_useComposerRenderer()`
 * and `useComposer()`.
 */
export interface ExperimentalComposerProps {}

/**
 * Draw bb's composer input box: the editor, its @-mention and slash-command
 * menus, attachments, voice input, the `+` and send menus and the send and
 * stop controls. It renders everywhere bb shows a composer (a thread's
 * composer, the New thread screen, queued and sent message editors). The
 * banners, approval cards and queued messages above the box stay bb's.
 *
 * Exclusive, like `experimental_threadList`: a composer from a plugin the
 * user installed wins over the bundled one, then the first in slot order.
 * Users choose under Settings → Appearance → Composer (`composer.provider`).
 * bb ships its own composer as the bundled Composer plugin; with no composer
 * plugin enabled, no composer is shown.
 *
 * The host keeps the draft, uploads, history, pickers and submission; the
 * component draws over them with `experimental_useComposerRenderer()`.
 */
export interface ExperimentalComposerRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Label shown in the provider choice and capability details. */
  title: string;
  /** Optional one-line description shown with the provider choice. */
  description?: string;
  component: ComponentType<ExperimentalComposerProps>;
}

/**
 * One way the box submits, worked out by the host for this surface and the
 * user's settings: what it does now, whether it needs a draft, and its key.
 */
export interface ExperimentalComposerAction {
  /**
   * `"send"` sends the draft, `"queue"` queues it behind the running turn,
   * `"steer"` adds it to the running turn.
   */
  kind: "send" | "queue" | "steer";
  /**
   * The action needs a non-empty draft. A steer does not: with an empty
   * draft it steers the next queued message.
   */
  requiresInput: boolean;
  /** The key that runs it, formatted for display. */
  shortcut: ExperimentalShortcutPresentation;
  /**
   * Run it without the checks `useComposer().submit()` applies: the box has
   * already decided it may. A failed send shows bb's error toast and restores
   * the draft.
   */
  run(): void;
}

/** Submit-button state and actions the host computes for a composer. */
export interface ExperimentalComposerSubmission {
  isSubmitting?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  label?: string;
  icon?: BbIconName;
  title?: string;
  isRunning?: boolean;
  onStop?: () => void;
  /** What Enter (and the send button) does. */
  enter: ExperimentalComposerAction;
  /** What modifier+Enter does, or null where the surface has one action. */
  modifier: ExperimentalComposerAction | null;
  /** Offer `modifier` in the send button's menu too, not only on its shortcut. */
  showModifierInMenu: boolean;
}

/** The characters that open the slash-command and skill menus. */
export type ExperimentalComposerCommandTrigger = "/" | "$";

/** The text typed after an @-mention or command trigger while its menu is open. */
export interface ExperimentalComposerSearchQuery<Trigger extends string> {
  text: string;
  trigger: Trigger;
}

/** How a suggested thread relates to the thread being composed in. */
export type ExperimentalComposerThreadRelation =
  | "parent"
  | "child"
  | "same-parent"
  | "same-environment";

type MentionTargetOf<Kind extends ExperimentalComposerMentionTarget["kind"]> =
  Extract<ExperimentalComposerMentionTarget, { kind: Kind }>;

/**
 * One @-mention result. `mention` is the pill choosing it inserts; `text` is
 * what the pill stands for after the trigger, such as `src/app.ts` or
 * `thread:thr_1`. `key` is stable across result updates.
 */
export type ExperimentalComposerMentionSuggestion = {
  key: string;
  text: string;
} & (
  | { kind: "path"; mention: MentionTargetOf<"path"> }
  | {
      kind: "thread";
      mention: MentionTargetOf<"thread"> & { projectId: string };
      /** The thread's own title; null when it has none and the pill shows its id. */
      title: string | null;
      /** The thread's project, when it differs from the composer's. */
      projectName: string | null;
      relation: ExperimentalComposerThreadRelation | null;
    }
  | { kind: "project"; mention: MentionTargetOf<"project"> }
  | { kind: "section"; mention: MentionTargetOf<"section"> }
  | {
      kind: "plugin";
      mention: MentionTargetOf<"plugin">;
      /** The mention provider's name, such as "Issues". */
      providerLabel: string;
      subtitle: string | null;
    }
);

/** Mention results under one heading, in display order. */
export interface ExperimentalComposerMentionSuggestionGroup {
  key: string;
  label: string;
  suggestions: readonly ExperimentalComposerMentionSuggestion[];
}

/** What `experimental_useComposerMentionSearch` returns. */
export interface ExperimentalComposerMentionSearch {
  /** `"idle"` without a query. */
  status: "idle" | "loading" | "error" | "ready";
  /** Earlier results are showing while newer ones load. */
  refreshing: boolean;
  groups: readonly ExperimentalComposerMentionSuggestionGroup[];
  /**
   * Set the open mention menu's query, or null when it closes. Call it from
   * the event that changes the menu, next to the composer's own state update,
   * so the results arrive in the same render.
   */
  search(
    query: ExperimentalComposerSearchQuery<PluginMentionTrigger> | null,
  ): void;
}

/** One slash-command or skill result. */
export interface ExperimentalComposerCommandSuggestion {
  kind: "command";
  name: string;
  source: "skill" | "command";
  origin: "builtin" | "project" | "user";
  description: string | null;
  argumentHint: string | null;
  /** The plugin that contributed the command; absent for the provider's own. */
  pluginId?: string;
}

/** Command results under one heading, such as "Skills", in display order. */
export interface ExperimentalComposerCommandSuggestionGroup {
  key: string;
  label: string;
  suggestions: readonly ExperimentalComposerCommandSuggestion[];
}

/** What `experimental_useComposerCommandSearch` returns. */
export interface ExperimentalComposerCommandSearch {
  /** `"idle"` without a query. */
  status: "idle" | "loading" | "error" | "ready";
  /** Earlier results are showing while newer ones load. */
  refreshing: boolean;
  /** Ranked for the query, under their headings. */
  groups: readonly ExperimentalComposerCommandSuggestionGroup[];
  /**
   * Set the open command menu's query, or null when it closes. Call it from
   * the event that changes the menu, next to the composer's own state update,
   * so the results arrive in the same render.
   */
  search(
    query: ExperimentalComposerSearchQuery<ExperimentalComposerCommandTrigger> | null,
  ): void;
}

/** An attachment upload that has not finished yet. */
export interface ExperimentalComposerPendingUpload {
  id: string;
  file: File;
}

/** The draft's attachments and bb's upload pipeline for them. */
export interface ExperimentalComposerAttachments {
  items?: readonly ComposerAttachment[];
  pendingUploads?: readonly ExperimentalComposerPendingUpload[];
  isAttaching?: boolean;
  error?: string | null;
  /** Upload files and add them to the draft; resolves with the added attachments. */
  onAttachFiles?(files: File[]): Promise<readonly ComposerAttachment[]>;
  onUpdate?(
    update: (
      attachments: readonly ComposerAttachment[],
    ) => readonly ComposerAttachment[],
  ): void;
  projectId?: string;
}

/** Up-arrow prompt history for the composer. */
export interface ExperimentalComposerHistory {
  currentDraft: ComposerDraftSnapshot;
  entries: readonly ComposerDraftSnapshot[];
  onSelectEntry(draft: ComposerDraftSnapshot): void;
  resetKey?: string | number;
}

export type ExperimentalVoiceDelivery = "insert" | "send";

/** A voice recording whose transcription failed, kept for retry. */
export interface ExperimentalFailedVoiceRecording {
  id: string;
  key: string;
  file: File;
  promptContext: string | undefined;
  delivery: ExperimentalVoiceDelivery;
  createdAt: number;
  errorMessage: string | null;
  retrying: boolean;
}

/** bb's voice input for the composer. */
export interface ExperimentalComposerVoice {
  state: "idle" | "recording" | "transcribing" | "error";
  delivery: ExperimentalVoiceDelivery;
  microphoneWarning: string | null;
  isSupported: boolean;
  /** Why voice input is unavailable, as a message safe to show; read it only while `isSupported` is false. */
  unsupportedMessage: string;
  stream: MediaStream | null;
  failedRecordings: readonly ExperimentalFailedVoiceRecording[];
  start(): void | Promise<void>;
  stop(): void;
  send(): void;
  retry(recording: ExperimentalFailedVoiceRecording): void;
  discard(recording: ExperimentalFailedVoiceRecording): void;
  download(recording: ExperimentalFailedVoiceRecording): void;
  cancel(): void;
}

/** A host shortcut prompt action in the composer's `+` menu. */
export interface ExperimentalComposerPromptAction {
  kind: "skills" | "plan" | "goal";
  text: string;
  /** The command the action puts at the start of the draft, if any. */
  command?: {
    trigger: ExperimentalComposerCommandTrigger;
    name: string;
    trailingText: string;
  };
}

/**
 * Everything the host passes to a composer box for one surface. Read and
 * write the draft with `useComposer().draft` and `replace`, and submit with
 * `useComposer().submit()`; inside a composer box they are bound to this box.
 * The box decides where bb's controls (`executionControls`, `handoff`,
 * `compactBeforeSend`) go, or whether to show them.
 */
export interface ExperimentalComposerInput {
  id?: string;
  /**
   * Where the box sits: a thread's composer (including queued and sent
   * message editors) or the New thread screen.
   */
  surface: "thread" | "new-thread";
  onEscape?(): void;
  placeholder?: string;
  autoFocus?: boolean;
  /** bb's model, reasoning effort and mode controls for this composer. */
  executionControls?: ReactNode;
  /** The "Handoff to new thread" banner, while a handoff is active. */
  handoff?: ReactNode;
  /** bb's chip offering to compact the context before sending. */
  compactBeforeSend?: ReactNode;
  submission: ExperimentalComposerSubmission;
  /** The editor's minimum height, from the space the host leaves above the box. */
  minHeight?: number;
  /** The most height the whole box may take; the editor scrolls inside it. */
  maxHeight?: number;
  /** Characters that open the @-mention menu; search with `experimental_useComposerMentionSearch`. */
  mentionTriggers: readonly PluginMentionTrigger[];
  /**
   * Characters that open the command menu; search with
   * `experimental_useComposerCommandSearch`. Never repeats a mention trigger:
   * when a plugin mention provider claims `$`, `$` opens the mention menu.
   */
  commandTriggers: readonly ExperimentalComposerCommandTrigger[];
  /**
   * What clicking a pill for `mention` does, or null when it is not a link.
   * An attachment mention opens the draft's attachment at that path, so an
   * attachment tile can ask with `{ kind: "attachment", path, label }`.
   */
  resolveMentionLink(
    mention: ExperimentalComposerMentionTarget,
  ): (() => void) | null;
  /** Whether menus fit above or below the box where the host placed it. */
  mentionMenuPlacement: "top" | "bottom";
  attachments?: ExperimentalComposerAttachments;
  promptActions?: readonly ExperimentalComposerPromptAction[];
  /** Collapse the box at the user's request; absent where it cannot collapse. */
  onCollapse?(): void;
  /**
   * When to show the box's one-line compact form, with `placeholder`;
   * absent, never. `"always"`: the host collapsed the box, on compact
   * viewports or after `onCollapse`. `"narrow"`: only while the thread pane
   * is short or its column narrow, which bb signals in CSS so it applies
   * without a render; style that form under
   * `@container follow-up-composer style(--follow-up-composer-container-compact: true)`.
   * Report the form the box shows in `editor.state.layout`.
   */
  compact?: { when: "always" | "narrow"; placeholder: string };
  history?: ExperimentalComposerHistory;
  voice?: ExperimentalComposerVoice;
}

/** A composer's scope, layout, draft summary and run state. */
export interface ExperimentalComposerView {
  scope: PluginComposerScope;
  layout: "expanded" | "compact" | "zen";
  draft: { text: string; isEmpty: boolean; attachmentCount: number };
  run: { isRunning: boolean; isSubmitting: boolean };
}

/** A contribution another plugin registered with `app.composer.customize`. */
export interface ExperimentalComposerContribution {
  /** Stable across renders; use it as the React key. */
  key: string;
  pluginId: string;
  customizationId: string;
  generation: number;
}

export interface ExperimentalComposerPlusMenuContribution extends ExperimentalComposerContribution {
  item: ComposerPlusMenuItem;
}

export interface ExperimentalComposerSendMenuContribution extends ExperimentalComposerContribution {
  item: ComposerSendMenuItem;
}

export interface ExperimentalComposerPopupContribution extends ExperimentalComposerContribution {
  popup: ExperimentalComposerPopupRegistration;
}

/**
 * Highlight rules to paint over the draft: bb's built-in highlights, other
 * plugins' `richText.effects` and `useComposer().setTextEffect` effects, in
 * paint order.
 */
export interface ExperimentalComposerDecorationSource {
  id: string;
  generation: string | number;
  pluginId?: string;
  effects: readonly NonNullable<ComposerRichTextSpec["effects"]>[number][];
}

/** Editor state a composer box reports so other plugins' `useComposer()` sees it. */
export interface ExperimentalComposerEditorState {
  layout: "expanded" | "compact";
  isRunning: boolean;
  isSubmitting: boolean;
  isSubmittingBlocked: boolean;
  submittingBlockedReason: string | null;
  isAttaching: boolean;
  attachmentError: string | null;
}

/**
 * What only the composer's editor can do, handed to
 * `experimental_ComposerRoot`: report its state, insert at its caret, take
 * focus, accept a dropped thread, run other plugins' popups and take voice
 * input. bb reaches the composer only through this.
 */
export interface ExperimentalComposerEditor {
  state: ExperimentalComposerEditorState;
  /** Mention ranges are relative to `value.text`. Return false without a caret. */
  insertAtCursor(value: ComposerDraft, block: boolean): boolean;
  /** Focus the editor, keeping its selection; false when it cannot take focus. */
  focus(): boolean;
  /** Focus the editor with the caret at the end of the draft. */
  focusEnd(): void;
  /** Whether threads dragged from the sidebar can be dropped now. */
  acceptsThreadDrop(): boolean;
  /**
   * Insert one mention per dropped thread, in order, starting at the viewport
   * point `x`, `y`. A drag from a multi-row sidebar selection drops several.
   */
  insertDroppedThreads(
    threads: readonly ExperimentalDroppedThreadMention[],
    x: number,
    y: number,
  ): void;
  openPopup(pluginId: string, popupId: string): boolean;
  closePopup(pluginId: string): boolean;
  isPopupOpen(): boolean;
  /** How the composer takes bb's voice input; omit when it has none. */
  voice?: ExperimentalComposerEditorVoice;
}

/** What a composer does with bb's voice input; recording and transcription stay bb's. */
export interface ExperimentalComposerEditorVoice {
  /** The draft before the caret, sent with a recording to help transcription; null when empty. */
  textBeforeCursor(): string | null;
  /** Put a finished transcript at the caret; with `"send"`, submit the draft after. */
  deliverTranscript(text: string, delivery: ExperimentalVoiceDelivery): void;
  /** Animate leaving voice mode; resolves when the composer is ready for the transcript. */
  playCompletionTransition(): Promise<void>;
}

/** Props of `experimental_ComposerRoot`. */
export interface ExperimentalComposerRootProps {
  /** The composer's outermost element. */
  rootRef: RefObject<HTMLElement | null>;
  editor: ExperimentalComposerEditor;
  /**
   * The composer's @-mention and command menu, and whether it is open, so
   * hosts that make room for it can measure it.
   */
  menuRef?: RefObject<HTMLElement | null>;
  menuOpen?: boolean;
}

/** The thread a bb thread link names, before it is resolved. */
export interface ExperimentalComposerThreadLinkTarget {
  threadId: string;
  projectId: string;
}

/** A thread a pasted bb thread link resolved to. */
export interface ExperimentalComposerThreadLink extends ExperimentalComposerThreadLinkTarget {
  label: string;
}

/** A thread an app drag dropped onto the composer. */
export interface ExperimentalDroppedThreadMention {
  threadId: string;
  label: string;
}

/** A keyboard shortcut formatted for display. */
export interface ExperimentalShortcutPresentation {
  ariaKeyshortcuts: string;
  label: string;
}

/** A bb message copied to the clipboard, read back on paste. */
export interface ExperimentalMessageClipboardPayload {
  text: string;
  imageUrl: string;
}

/** bb thread links in the composer, from `experimental_useComposerRenderer().threadLinks`. */
export interface ExperimentalComposerThreadLinks {
  /**
   * The thread `url` links to when it is a thread link of this bb, or null.
   * `projectId` is the project the link names, or the personal project for
   * a link without one; a thread outside that project is not this link.
   */
  parse(url: string): ExperimentalComposerThreadLinkTarget | null;
  /** A linked thread from bb's caches, without a request. */
  cached(threadId: string): ExperimentalComposerThreadLink | null;
  /**
   * Fetch linked threads in batches, calling `onBatch` as each batch lands
   * so a deadline can keep the batches that finished. Threads that do not
   * exist are left out. Resolves once every batch has settled.
   */
  resolve(
    threadIds: readonly string[],
    signal: AbortSignal,
    onBatch: (threads: readonly ExperimentalComposerThreadLink[]) => void,
  ): Promise<void>;
}

/** bb messages copied to the clipboard, from `experimental_useComposerRenderer().clipboard`. */
export interface ExperimentalComposerClipboard {
  /** Read a bb message copied as HTML, or null. */
  readMessage(html: string): ExperimentalMessageClipboardPayload | null;
  /** Fetch a copied bb message's image as a file; rejects when it is unavailable. */
  readMessageImage(imageUrl: string, signal: AbortSignal): Promise<File>;
}

/**
 * Inputs, host state and host services for one composer box. Only available
 * inside an `experimental_composer` component; it throws elsewhere.
 */
export interface ExperimentalComposerRendererApi {
  readonly input: ExperimentalComposerInput;
  /** The composer this box draws: scope, layout, draft and run state. */
  readonly view: ExperimentalComposerView;
  /** Stable identity of this composer's draft (`useComposer().key`). */
  readonly key: string;
  /** A plugin locked editing through `useComposer().setInputLock(true)`. */
  readonly inputLocked: boolean;
  /** The shortcut of bb's "Focus composer" command, or null when unbound. */
  readonly focusComposerShortcut: ExperimentalShortcutPresentation | null;
  /**
   * Every highlight rule to paint over the draft, in paint order. The host
   * runs other plugins' draft observers itself.
   */
  readonly decorationSources: readonly ExperimentalComposerDecorationSource[];
  readonly threadLinks: ExperimentalComposerThreadLinks;
  readonly clipboard: ExperimentalComposerClipboard;
  /**
   * Run bb's app keyboard command for `event`, if any; returns whether one
   * ran. Call it from the editor's key handler before handling the key
   * itself, skipping IME composition: editors swallow keys before bb's
   * window-level shortcuts see them.
   */
  dispatchAppCommandKey(event: KeyboardEvent): boolean;
  /** Show an error toast. */
  showError(message: string): void;
  /**
   * Image URL for an attachment: the local preview while it is still
   * uploading, else the uploaded file, resolved through the project when
   * given. bb releases local previews when attachments leave the draft.
   */
  attachmentSrc(path: string, projectId?: string): string;
}

/**
 * Other plugins' contributions to this composer, from
 * `experimental_useComposerContributions()`, with a host renderer for each
 * kind. Surfaces that hide plugin customizations return no popups, send
 * menu items or actions.
 */
export interface ExperimentalComposerContributions {
  /** Popups other plugins open with `useComposer().openPopup`; render the open one with `Popup`. */
  readonly popups: readonly ExperimentalComposerPopupContribution[];
  /** Render each with `MenuEntry` and `kind: "plus"`. */
  readonly plusMenuItems: readonly ExperimentalComposerPlusMenuContribution[];
  /** Render each with `MenuEntry` and `kind: "send"`. */
  readonly sendMenuItems: readonly ExperimentalComposerSendMenuContribution[];
  /** Other plugins' inline actions, for the composer's action row. */
  readonly Actions: ComponentType;
  readonly Popup: ComponentType<ExperimentalComposerPopupProps>;
  readonly MenuEntry: ComponentType<ExperimentalComposerMenuEntryProps>;
}

/** Props of `ExperimentalComposerContributions.Popup`. */
export interface ExperimentalComposerPopupProps {
  contribution: ExperimentalComposerPopupContribution;
  onClose(): void;
}

/** What a selected `+` or send menu entry hands back to the menu. */
export interface ExperimentalComposerMenuSelection {
  restoreComposerFocus(): void;
  selectedElement: Element | null;
}

/** Props of `ExperimentalComposerContributions.MenuEntry`. */
export type ExperimentalComposerMenuEntryProps =
  | {
      kind: "plus";
      contribution: ExperimentalComposerPlusMenuContribution;
      onSelected?(selection: ExperimentalComposerMenuSelection): void;
    }
  | {
      kind: "send";
      contribution: ExperimentalComposerSendMenuContribution;
      onSelected?(selection: ExperimentalComposerMenuSelection): void;
    };

/** Props of `experimental_VoiceInputButton`: bb's button with a microphone warning tooltip. */
export interface ExperimentalVoiceInputButtonProps extends ComponentPropsWithRef<"button"> {
  warning: string | null;
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
  "data-promptbox-expanded-only"?: string;
  "data-promptbox-submit-action"?: string;
}

/** Props of `experimental_VoiceRecordingBar`. */
export interface ExperimentalVoiceRecordingBarProps {
  isCompact: boolean;
  state: "recording" | "transcribing";
  delivery: ExperimentalVoiceDelivery;
  stream: MediaStream | null;
  microphoneWarning: string | null;
  submitIcon: BbIconName;
  onConfirm(): void;
  onSend(): void;
  onCancel(): void;
}

/** Props of `experimental_FailedVoiceRecordings`. */
export interface ExperimentalFailedVoiceRecordingsProps {
  recordings: readonly ExperimentalFailedVoiceRecording[];
  className: string;
  retryDisabled: boolean;
  onRetry(recording: ExperimentalFailedVoiceRecording): void;
  onDownload(recording: ExperimentalFailedVoiceRecording): void;
  onDiscard(recording: ExperimentalFailedVoiceRecording): void;
}

/** Props of `experimental_ShortcutHint`. */
export interface ExperimentalShortcutHintProps {
  shortcut: ExperimentalShortcutPresentation | null;
  className?: string;
}

/** Props of `experimental_ImageLightbox`. */
export interface ExperimentalImageLightboxProps {
  hasMultipleImages?: boolean;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  navigationStatus?: string;
  mediaType?: "image" | "video";
  imageAlt: string;
  imageSrc: string | null;
  isOpen?: boolean;
  onClose(): void;
  onNext?(): void;
  onPrevious?(): void;
  title: string;
}

/** How bb draws an @-mention pill, from `experimental_describePromptMention`. */
export interface ExperimentalPromptMentionPresentation {
  /** bb's pill classes; add your own after them. */
  className: string;
  /** The pill's tooltip, such as `src/app.ts` or `/review <files>`. */
  title: string;
  /** The pill as text, naming its kind: `Thread: Fix login`. */
  text: string;
}

/** A pill read back from pasted HTML by `experimental_readPromptMentionClipboard`. */
export interface ExperimentalPromptMentionClipboardPill {
  mention: ExperimentalComposerMentionTarget;
  /** The draft text the pill covers, such as `@src/app.ts`. */
  text: string;
}

/** Props of `experimental_PromptMentionIcon`. */
export interface ExperimentalPromptMentionIconProps {
  mention: ExperimentalComposerMentionTarget;
  className?: string;
}

/** Props of `experimental_PluginIcon`: a plugin's branding icon. */
export interface ExperimentalPluginIconProps {
  pluginId: string;
  icon: string | null;
  className?: string;
}

/** Props of `experimental_ThreadTitleText`: a raw thread title with its @-mentions resolved. */
export interface ExperimentalThreadTitleTextProps {
  title: string;
  className?: string;
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
 * Render fenced code blocks of chosen languages inside assistant (and nested
 * agent) message Markdown. ` ```ui ` matches a registration whose `languages`
 * include `"ui"`. Fences elsewhere (user messages, file previews, plugin
 * Markdown) keep BB's code block.
 *
 * BB's code block also renders when two plugins claim the same language (BB
 * logs a warning naming them), when the plugin is disabled, and for a fence
 * whose component throws. A throw affects that fence only, and BB tries the
 * component again when the fence's `code` or `status` changes.
 *
 * @experimental Audit before relying on this as a stable contract.
 */
export interface ExperimentalCodeFenceRendererRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /**
   * Lowercase info-string languages, e.g. `["ui", "app"]`. Each starts with a
   * letter or digit and contains only `a-z`, `0-9`, `+`, `#`, `.`, `_`, `-`.
   * A language may be claimed once per plugin.
   */
  languages: readonly string[];
  component: ComponentType<ExperimentalCodeFenceRendererProps>;
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
  /**
   * The event sequence that recorded this message: the `msg` value of a
   * message link and the seq that `sdk.threads.message` and
   * `bb thread log --message` read. For a steer this is its request sequence,
   * which can differ from the acceptance sequence in `sourceSeqEnd`.
   */
  experimental_messageSeq: number;
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
  /** The side panel of the thread view whose timeline surfaced the action. */
  experimental_panel: ExperimentalPanelController;
  /**
   * The composer of the thread the message is in, or null when that thread's
   * composer is not available on this surface. The same handle
   * `useComposer()` returns there.
   */
  composer: PluginComposerApi | null;
}

/**
 * An action on chat messages in the main thread timeline: an icon button in
 * the per-message action bar (user and assistant messages) and an entry in
 * the assistant-message text-selection menu. Embedded `ThreadChat` timelines
 * do not show slot-registered actions. Host-rendered chrome — the plugin
 * supplies title, icon, and `run` behavior only. Resolved icon names take precedence over
 * plugin branding; omitted or unknown names fall back to branding.
 */
export interface PluginMessageActionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Tooltip / menu label for the action. */
  title: string;
  icon?: BbIconName;
  /**
   * Runs when the user activates the action. Errors (sync or async) are
   * contained and logged; they never break the timeline.
   */
  run(context: PluginMessageActionContext): void | Promise<void>;
}

/** Current context for palette and keyboard command invocations. */
export interface PluginCommandContext {
  /** The thread in view, or null on a surface without one. */
  threadId: string | null;
  projectId: string | null;
  /**
   * The focused surface's side panel: the thread view or New thread screen
   * in focus, or the focused plugin page. On the New thread screen, a
   * `{ context: { kind: "thread" }, availability: "action" }` tab resolves
   * against `experimental_newThreadPanelAction` with the same id, so register
   * both slots with the same id to support commands on both screens. Calls
   * return false when the focused surface has no such tab or no side panel;
   * guard with `isAvailable` rather than assuming.
   */
  experimental_panel: ExperimentalPanelController;
}

/** A default keyboard shortcut. Omitted modifiers are false. */
export interface PluginCommandShortcut {
  key: string;
  /** Command on macOS, Control elsewhere. */
  mod?: boolean;
  meta?: boolean;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/**
 * A command registered with `app.commands.register`, listed in bb's quick
 * palette (Mod+Shift+P) under the plugin's name
 * beside bb's own commands. Host-rendered: the plugin supplies a title and
 * `run`, and the host owns matching, ordering, and recency.
 */
export interface PluginCommandRegistration {
  /** Initial keyboard binding. Users can rebind every command, including ones without a default. Conflicting defaults remain unbound. */
  defaultShortcut?: PluginCommandShortcut;
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** The row's label, e.g. "Linear: open issue for this thread". */
  title: string;
  /**
   * Hide the row when it cannot do anything — typically when it needs a thread
   * and there is none. Called before palette listing and keyboard invocation;
   * keep it cheap and synchronous. Omitted means always listed.
   */
  isAvailable?(context: PluginCommandContext): boolean;
  /**
   * Runs on keyboard invocation, or after the palette closes and focus is
   * restored. Errors (sync or async) are contained and logged; they never break the palette.
   */
  run(context: PluginCommandContext): void | Promise<void>;
}

/**
 * A command handled by a composer through the same path as bb's own "Focus
 * composer" command. Listed, rebindable and namespaced like any other plugin
 * command. The composer holding the caret runs it; with the caret outside every
 * composer, the focused pane's primary composer does. Like bb's composer
 * commands, its shortcut is inactive while a terminal, browser tab or modal has
 * focus, and the palette lists it only when some composer would run it.
 */
export interface ExperimentalComposerCommandRegistration {
  /** Initial keyboard binding. Users can rebind every command, including ones without a default. Conflicting defaults remain unbound. */
  defaultShortcut?: PluginCommandShortcut;
  /** Unique within the plugin across every command; letters, digits, `-`, `_`. */
  id: string;
  /** The palette row's and keyboard settings' label. */
  title: string;
  /**
   * Runs with the handling composer, bound to this plugin like `useComposer()`.
   * Errors (sync or async) are contained and logged.
   */
  run(context: { composer: PluginComposerApi }): void | Promise<void>;
}

/** Registers commands for bb's command palette. */
export interface PluginAppCommands {
  /** Register a command. IDs are unique within this plugin, including legacy slot registrations. */
  register(registration: PluginCommandRegistration): void;
}

/**
 * Supply an inline React mark for a provider. Agent, machine, and environment
 * icon renderers select the mark by provider kind and id.
 * Only surfaces using the provider icon renderer consult this slot. Persistent
 * machine labels use a laptop glyph directly.
 *
 * Provider logo assets use a currentColor mask. Inline components can also
 * render multiple colors and inherit the app's theme and sizing classes.
 *
 * The host passes `className` for sizing; color inherits from its wrapper.
 * the component must render an inline SVG (or other inline markup) and must
 * not fetch. One registration per provider kind and id per plugin; when two
 * plugins claim the same pair the host keeps the first by plugin id and warns.
 */
export interface PluginProviderIconRegistration {
  providerKind: "agent" | "machine" | "environment";
  /**
   * The provider this mark is for — the id bb knows the provider by (the
   * provider declaration's id, e.g. `codex` or `acp-cursor`), not the plugin
   * id. Letters, digits, `-`, `_`.
   */
  providerId: string;
  /** Inline, theme-aware mark. Receives the host's sizing/color className. */
  icon: ComponentType<{ className?: string }>;
}

/**
 * The declarative presentation persisted with a timeline item (docs/
 * provider-plugin-api.md §3): what every client renders when no plugin code
 * is present. A renderer receives it so it can reuse the bridge's label,
 * glyph and tint instead of re-deriving them from the payload.
 */
export interface PluginTimelineRowPresentation {
  label: { pending: string; completed: string };
  icon: { glyph: string };
  title?: string;
  /** Short Markdown, length-capped at ingest. */
  detail?: string;
  suppress?: boolean;
  tint?: { light: string; dark: string };
}

export type PluginTimelineRowStatus =
  | "pending"
  | "completed"
  | "error"
  | "interrupted";

/** The projected row a `experimental_timelineRenderer` component receives. */
export interface PluginTimelineRendererRow {
  id: string;
  threadId: string;
  turnId: string | null;
  /**
   * The item kind the renderer registered for: this plugin's extension kind
   * (`"<pluginId>/<name>"`) or `"tool"` for a generic tool item.
   */
  kind: string;
  /** The tool name for a `"tool"` row; null for an extension row. */
  toolName: string | null;
  status: PluginTimelineRowStatus;
  startedAt: number;
  completedAt: number | null;
}

export interface PluginTimelineRendererProps {
  row: PluginTimelineRendererRow;
  /**
   * The item's data: an extension item's payload (validated against the
   * plugin's declared schema at ingest), or for a `"tool"` row the call's
   * `{ arguments, output }`.
   */
  payload: JsonValue;
  /**
   * The bridge's presentation for the row. Null only for a generic tool row
   * persisted before bridges attached presentation (grammar v2); an
   * extension row always has one.
   */
  presentation: PluginTimelineRowPresentation | null;
  /** The thread the row belongs to. */
  thread: { id: string; providerId: string | null };
  /**
   * The host's declarative base for this row's body (the presentation's
   * `detail`, or the tool call's arguments and output). Render it to keep
   * the default body beside the plugin's own content.
   */
  Original: ComponentType<Record<never, never>>;
}

/**
 * Render the expanded body of the timeline rows this plugin owns: its own
 * extension item kinds (`"<pluginId>/<name>"`, where `<pluginId>` is this
 * plugin), and `"tool"` for the generic tool items of the providers this
 * plugin registered. Core kinds (message, command, fileChange, fileRead,
 * search, delegation, planSteps, …) always use the core renderers and are
 * customized through the bridge's presentation alone.
 *
 * The row's header — the bridge's label, glyph, tint and headline — stays
 * host-rendered so the timeline reads uniformly; the component owns the
 * body. When no renderer is registered for a kind (the plugin is not loaded,
 * uninstalled, or never shipped an app bundle) the declarative base renders
 * instead, so a row never goes blank. Crashes are contained per row.
 */
export interface PluginTimelineRendererRegistration {
  /**
   * `"<pluginId>/<name>"` for one of this plugin's extension kinds, or
   * `"tool"` for the generic tool items of this plugin's providers.
   */
  kind: string;
  component: ComponentType<PluginTimelineRendererProps>;
}

/**
 * Props passed to an `experimental_environmentProviderInputs` component — the
 * control the New Thread environment picker renders beside this plugin's
 * selected environment provider, for the provider's declared `inputs`.
 */
export interface PluginEnvironmentProviderInputsProps {
  /** Project selected in the composer; null in projectless compose. */
  projectId: string | null;
  /** Whether setup uses an existing host or provisions a new host before create. */
  target: { kind: "existing-host"; hostId: string } | { kind: "new-host" };
  /**
   * The `inputs` value the selection will carry: null until `onChange`
   * supplies one.
   * The server parses it with the provider's `inputs` schema at create time,
   * so the component only has to produce a value that schema accepts.
   */
  value: JsonValue | null;
  /**
   * Replace the inputs that will be submitted or block submission with the
   * reason the control should show.
   */
  onChange(next: PluginEnvironmentProviderInputsChange): void;
}

export type PluginEnvironmentProviderInputsChange =
  | { status: "ready"; value: JsonValue }
  | { status: "blocked"; reason: string };

/**
 * Supply the control for one of this plugin's environment providers that
 * declared `inputs` (registered server-side via
 * `bb.experimental_environments.register`). The New Thread environment picker
 * renders the component beside the picker while that provider is selected and
 * submits the component's latest `onChange` value as the selection's `inputs`.
 * A provider whose schema rejects empty inputs cannot be submitted without a
 * registration that reports ready inputs.
 */
export interface PluginEnvironmentProviderInputsRegistration {
  /** The environment provider id this control supplies inputs for. */
  environmentProviderId: string;
  component: ComponentType<PluginEnvironmentProviderInputsProps>;
}

/**
 * Props passed to an `experimental_machineProviderInputs` component. Machine
 * inputs are persisted and readable by every plugin, so they must contain only
 * non-secret configuration and references to credentials held in plugin
 * settings.
 */
export interface PluginMachineProviderInputsProps {
  /** The value persisted with the machine selection. */
  value: JsonValue | null;
  /** Replace the submitted value or block submission with a visible reason. */
  onChange(next: PluginMachineProviderInputsChange): void;
}

export type PluginMachineProviderInputsChange =
  | { status: "ready"; value: JsonValue }
  | { status: "blocked"; reason: string };

/**
 * Supply the inputs control for one machine provider registered server-side
 * through `bb.experimental_machines.register`.
 */
export interface PluginMachineProviderInputsRegistration {
  /** The machine provider id this control supplies inputs for. */
  machineProviderId: string;
  component: ComponentType<PluginMachineProviderInputsProps>;
}

// ---------------------------------------------------------------------------
// definePluginApp
// ---------------------------------------------------------------------------

export interface PluginAppSlots {
  homepageSection(registration: PluginHomepageSectionRegistration): void;
  settingsSection(registration: PluginSettingsSectionRegistration): void;
  /**
   * Render one app-wide overlay component (see
   * {@link ExperimentalAppOverlayRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_appOverlay(
    registration: ExperimentalAppOverlayRegistration,
  ): void;
  navPanel(registration: PluginNavPanelRegistration): void;
  /** Register a context-scoped tab. Experimental: see docs/api_to_audit.md. */
  experimental_tab<
    C extends ExperimentalTabContext,
    A extends "fixed" | "action",
  >(
    registration: ExperimentalTabInput<C, A>,
  ): void;
  experimental_tab(registration: ExperimentalTabRegistration): void;
  experimental_newThreadPanelAction(
    registration: PluginNewThreadPanelActionRegistration,
  ): void;
  pendingInteraction(registration: PluginPendingInteractionRegistration): void;
  sidebarFooterAction(
    registration: PluginSidebarFooterActionRegistration,
  ): void;
  /**
   * Replace the sidebar's thread list (see
   * {@link PluginThreadListRegistration}). Experimental: see
   * docs/api_to_audit.md for what to audit before the prefix drops.
   */
  experimental_threadList(registration: PluginThreadListRegistration): void;
  /**
   * Draw the sidebar navigation and its header controls (see
   * {@link ExperimentalSidebarNavigationRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_sidebarNavigation(
    registration: ExperimentalSidebarNavigationRegistration,
  ): void;
  /**
   * Add context beside an existing thread's composer (see
   * {@link ExperimentalThreadContextSegmentRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_threadContextSegment(
    registration: ExperimentalThreadContextSegmentRegistration,
  ): void;
  /**
   * Add a small item to the metadata line of every thread row in thread
   * lists (see
   * {@link ExperimentalThreadRowMetadataRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_threadRowMetadata<Data = undefined>(
    registration: ExperimentalThreadRowMetadataRegistration<Data>,
  ): void;
  /**
   * Add a row to the thread Info tab's details block (see
   * {@link ExperimentalThreadInfoRowRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_threadInfoRow(
    registration: ExperimentalThreadInfoRowRegistration,
  ): void;
  /**
   * Add a section to the thread Info tab (see
   * {@link ExperimentalThreadInfoSectionRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_threadInfoSection(
    registration: ExperimentalThreadInfoSectionRegistration,
  ): void;
  /**
   * Add an action to every thread actions menu (see
   * {@link PluginThreadActionRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_threadAction<Data = undefined>(
    registration: PluginThreadActionRegistration<Data>,
  ): void;
  /** Render a component beside each Browser tab's address bar. */
  experimental_browserToolbarAction(
    registration: ExperimentalPluginBrowserToolbarActionRegistration,
  ): void;
  fileOpener(registration: PluginFileOpenerRegistration): void;
  /**
   * Replace BB's source-code renderer (see
   * {@link PluginSourceCodeRendererRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_sourceCodeRenderer(
    registration: PluginSourceCodeRendererRegistration,
  ): void;
  /**
   * Replace BB's diff renderer (see
   * {@link PluginDiffRendererRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_diffRenderer(registration: PluginDiffRendererRegistration): void;
  /**
   * Replace the input box of bb's thread composer (see
   * {@link ExperimentalComposerRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_composer(registration: ExperimentalComposerRegistration): void;
  messageDirective(registration: PluginMessageDirectiveRegistration): void;
  /**
   * Render fenced code blocks of chosen languages in assistant messages (see
   * {@link ExperimentalCodeFenceRendererRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_codeFenceRenderer(
    registration: ExperimentalCodeFenceRendererRegistration,
  ): void;
  messageAction(registration: PluginMessageActionRegistration): void;
  /**
   * @deprecated Use `app.commands.register` with the same registration.
   * Both entry points share the same command registry and ID namespace.
   */
  commandPaletteAction(registration: PluginCommandRegistration): void;
  /**
   * Draw one agent, environment, or machine provider's icon with an inline
   * React component instead of its masked logo asset (see
   * {@link PluginProviderIconRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_providerIcon(registration: PluginProviderIconRegistration): void;
  /**
   * Render the body of this plugin's own timeline rows: its extension kinds
   * and its providers' generic tool items (see
   * {@link PluginTimelineRendererRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_timelineRenderer(
    registration: PluginTimelineRendererRegistration,
  ): void;
  /**
   * Supply the inputs control the New Thread environment picker renders
   * beside one of this plugin's selected environment providers (see
   * {@link PluginEnvironmentProviderInputsRegistration}). Experimental:
   * see docs/api_to_audit.md.
   */
  experimental_environmentProviderInputs(
    registration: PluginEnvironmentProviderInputsRegistration,
  ): void;
  /**
   * Supply the non-secret machine inputs control rendered by machine creation
   * surfaces (see {@link PluginMachineProviderInputsRegistration}).
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_machineProviderInputs(
    registration: PluginMachineProviderInputsRegistration,
  ): void;
}

export interface PluginAppComposer {
  customize(registration: ComposerCustomization): void;
  /** Register a command that the composer holding the caret runs. IDs share the `app.commands` namespace. */
  experimental_registerCommand(
    registration: ExperimentalComposerCommandRegistration,
  ): void;
}

/** Stable lifecycle values for one content-script instance in one bb client. */
export interface PluginContentScriptContext {
  /** The id of the plugin that owns this script. */
  readonly pluginId: string;
  /** Monotonic per-client generation, starting at 1. */
  readonly generation: number;
  /** Aborted before cleanup begins on replacement, deactivation, or teardown. */
  readonly signal: AbortSignal;
  /**
   * Persistently decorate any thread row for this plugin generation.
   *
   * The status is owned by the frontend generation and therefore survives
   * route changes. Passing `null` clears the plugin's status for that thread.
   * The host clears every remaining status when the frontend generation
   * deactivates.
   *
   * Optional so bundles can feature-detect support while this experimental
   * surface rolls out across 0.x clients.
   */
  readonly experimental_setThreadRowStatus?: (
    threadId: string,
    status: PluginComposerThreadRowStatus | null,
  ) => void;
}

/** Cleanup returned by a frontend content script. */
export type PluginContentScriptDisposer = () => void | Promise<void>;

/**
 * Trusted same-origin JavaScript/TypeScript mounted once per active frontend
 * generation in each bb app window or browser tab.
 */
export interface PluginContentScriptRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /**
   * Install behavior into the bb app shell. The host awaits a returned
   * promise, retains the plugin's imported frontend stylesheet for this
   * generation, contains failures, and calls the returned disposer exactly
   * once. Styling or decorating existing app-shell DOM belongs here rather
   * than in an always-on frontend stylesheet.
   */
  mount(
    context: PluginContentScriptContext,
  ):
    | void
    | PluginContentScriptDisposer
    | Promise<void | PluginContentScriptDisposer>;
}

/** Lifecycle surface for trusted frontend content scripts. */
export interface PluginAppContentScripts {
  register(registration: PluginContentScriptRegistration): void;
}

export interface ExperimentalIconProps {
  name: string;
  /** Used when the requested name is missing; defaults to the host Zap icon. */
  fallback?: string;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

/** Shared agent, machine, or environment artwork without fetching metadata. */
export interface ExperimentalProviderIconProps {
  /** Keeps same-id agent, machine, and environment providers distinct. */
  providerKind: PluginProviderIconRegistration["providerKind"];
  /**
   * Existing agent, machine, or environment provider record. Reads id, logoUrl, icon and
   * strings.iconTint; other fields are ignored. An id-only record is sufficient
   * when only frontend registrations and fallback are needed. Does not fetch.
   */
  provider: {
    id: string;
    logoUrl?: string | null;
    /** Agent providers use { glyph }; machine and environment providers use a string. */
    icon?: { glyph: string } | string | null;
    strings?: { iconTint?: { light: string; dark: string } | null } | null;
  };
  /** Used when no artwork is available; defaults to Code. */
  fallback?: string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

/**
 * An app icon registered by a plugin. The registry is app-wide: a registered
 * name is usable wherever a `BbIconName` is — `experimental_Icon`, and every
 * host-rendered surface that takes one — by this plugin or any other.
 */
export interface ExperimentalIconRegistration {
  /** Shared app name. Namespacing is recommended, but not required. */
  name: string;
  /** Inline artwork. Honor className for sizing; use currentColor for tint. */
  component: ComponentType<{ className?: string }>;
}

export interface ExperimentalAppIcons {
  /**
   * Add or override an app icon during setup. A registered name shadows a
   * built-in of the same name. Returns nothing; the host replaces
   * registrations on reload and removes them on unload. Duplicate names within
   * a plugin reject setup. Between plugins, the first plugin id in lexical
   * order wins, independent of bundle load order.
   */
  register(registration: ExperimentalIconRegistration): void;
}

export interface PluginAppBuilder {
  experimental_icons: ExperimentalAppIcons;
  commands: PluginAppCommands;
  slots: PluginAppSlots;
  composer: PluginAppComposer;
  contentScripts: PluginAppContentScripts;
  /** Experimental managed region for actions and disclosures in the sidebar footer. */
  experimental_sidebarFooter: ExperimentalSidebarFooter;
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
  values: Record<string, string | number | boolean> | undefined;
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
      kind: "new-thread";
      /** Root compose's effective selected project; null only while unresolved. */
      projectId: string | null;
    };

/** One plugin-owned composer customization registration. */
export interface ComposerCustomization {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Composer kinds where this customization is active; omit for all kinds. */
  scopes?: readonly PluginComposerScope["kind"][];
  actions?: readonly { id: string; component: ComponentType }[];
  banners?: readonly {
    id: string;
    /** Host chrome around the banner. Defaults to `"card"`. */
    chrome?: "card" | "bare";
    component: ComponentType;
  }[];
  plusMenu?: readonly ComposerPlusMenuItem[];
  /** Host-rendered rows in the menu next to the composer's send button. */
  sendMenu?: readonly ComposerSendMenuItem[];
  richText?: ComposerRichTextSpec;
  /** Host-managed popups sharing the mention menu's above/below placement, with a responsive drawer on compact screens. Open by popup id, unique within this plugin. */
  experimental_popups?: readonly ExperimentalComposerPopupRegistration[];
}

/** Content for one composer's popup. The host owns placement, dismissal and focus restoration; the component owns its content and keyboard navigation. */
export interface ExperimentalComposerPopupRegistration {
  /** Popup id, unique across this plugin's composer customizations. */
  id: string;
  /** Accessible name of the popup and compact drawer. */
  label: string;
  /** Inside this component, useComposer() is bound to the composer that opened it. */
  component: ComponentType;
}

/** Host-rendered menu row in the composer's `+` menu. */
export interface ComposerPlusMenuItem {
  id: string;
  label: string;
  /** Takes precedence over the plugin's `bb.branding.icon`, which is drawn when this is omitted. */
  icon?: BbIconName;
  /** Accessible description for the host-rendered row. */
  description?: string;
  disabled?: boolean | ((composer: PluginComposerApi) => boolean);
  run(context: { composer: PluginComposerApi }): void | Promise<void>;
}

/**
 * Host-rendered row in the menu next to the composer's send button, for
 * alternatives to sending right away (save as a draft, send later). The menu
 * shows only while the composer can submit.
 */
export interface ComposerSendMenuItem {
  id: string;
  label: string;
  /** Takes precedence over the plugin's `bb.branding.icon`, which is drawn when this is omitted. */
  icon?: BbIconName;
  /** Accessible description for the host-rendered row. */
  description?: string;
  disabled?: boolean | ((composer: PluginComposerApi) => boolean);
  run(context: { composer: PluginComposerApi }): void | Promise<void>;
}

/**
 * Reactive read-side of the composer a plugin surface is mounted in.
 * @internal Superseded by `useComposer()`; kept for plugins built against
 * older SDKs.
 */
export interface ComposerView {
  scope: PluginComposerScope;
  layout: "expanded" | "compact" | "zen";
  draft: { text: string; isEmpty: boolean; attachmentCount: number };
  run: { isRunning: boolean; isSubmitting: boolean };
}

export interface ComposerRichTextSpec {
  /** Content-derived paint: match ranges receive `className`; text is never mutated. */
  effects?: readonly {
    id: string;
    /** Plain-text offsets into the current structured draft. */
    match(text: string): readonly { from: number; to: number }[];
    className: string;
  }[];
  /**
   * Debounced, read-only observation of the structured draft.
   * @internal Superseded by `useComposer().draft`; kept for plugins built
   * against older SDKs.
   */
  onDraftChange?(draft: ComposerStructuredDraft, view: ComposerView): void;
}

/**
 * @internal Superseded by {@link ComposerDraft}; kept for plugins built
 * against older SDKs.
 */
export interface ComposerStructuredDraft {
  text: string;
  mentions: readonly {
    from: number;
    to: number;
    provider: string;
    id: string;
    label: string;
  }[];
}

/** The composer's text and the @-mention pills in it. */
export interface ComposerDraft {
  text: string;
  mentions: readonly ComposerMention[];
}

/**
 * A composer attachment: an uploaded file, optionally owned by another
 * project, or an absolute path on one machine. Never both.
 */
export type ComposerAttachment = {
  type: "localImage" | "localFile";
  path: string;
  name: string;
  mimeType?: string;
  /** Exact size in bytes; omit when unknown. Zero is treated as unknown. A wrong nonzero size can make the send fail when bb stages a file. */
  sizeBytes?: number;
} & (
  | {
      /** Project that currently owns this uploaded path; omit for destination-relative attachments. */
      sourceProjectId?: string;
      hostId?: never;
    }
  | {
      /** Machine whose absolute `path` this is; core rejects sending it to a thread on another machine. */
      hostId: string;
      sourceProjectId?: never;
    }
);

/** The complete current draft. Snapshots and their entries are immutable. */
export interface ComposerDraftSnapshot extends ComposerDraft {
  readonly attachments: readonly ComposerAttachment[];
}

/** Atomic text and mention replacement, optionally replacing uploaded attachments too. */
export interface ComposerDraftReplacement extends ComposerDraft {
  /** Omit to preserve attachments; supply an empty array to remove them all. Does not upload or copy files. */
  attachments?: readonly ComposerAttachment[];
}

/**
 * One @-mention pill: its range in `ComposerDraft.text` plus everything the
 * host needs to recreate it, so a mention read from `draft` can be passed
 * back to `insert` unchanged.
 */
export type ComposerMention = {
  from: number;
  to: number;
  label: string;
} & (
  | { kind: "thread"; threadId: string; projectId?: string }
  | { kind: "project"; projectId: string }
  | { kind: "section"; sectionId: string }
  | {
      kind: "path";
      path: string;
      source: "workspace" | "thread-storage";
      entryKind: "file" | "directory";
    }
  | {
      kind: "command";
      trigger: "/" | "$";
      name: string;
      source: "skill" | "command";
      origin: "builtin" | "project" | "user";
      argumentHint: string | null;
    }
  | {
      kind: "attachment";
      /** The stored path of a file attached to the same draft. */
      path: string;
    }
  | {
      kind: "plugin";
      /** The plugin that owns the pill. */
      pluginId: string;
      /** The mention provider id that plugin registered. */
      provider: string;
      /** The item id the provider's `resolve` receives at send time. */
      id: string;
      icon?: string | null;
    }
);

/**
 * What `insert` accepts: text, a mention read from `draft` (any kind), or one
 * of the calling plugin's own mentions (`{ provider, id, label }`, no `kind`).
 */
export type ComposerInsertPart =
  | string
  | ComposerMention
  | PluginComposerMention;

/** What an @-mention pill points at: a {@link ComposerMention} without its place in the text. */
export type ExperimentalComposerMentionTarget = ComposerMention extends infer M
  ? M extends ComposerMention
    ? Omit<M, "from" | "to">
    : never
  : never;

/** Where `insert` puts its content. */
export interface ComposerInsertOptions {
  /**
   * `"cursor"` (default) inserts at the editor's selection, replacing any
   * selected text; the selection is kept while focus is elsewhere, and the
   * composer must be on screen. `"end"` inserts after the last character and
   * also works for a composer that is not on screen.
   */
  at?: "cursor" | "end";
  /** Put the content on its own paragraph, adding a paragraph break before and after only where text is adjacent. */
  block?: boolean;
}

/** Host-rendered paint applied to the editable composer text. */
export interface PluginComposerTextEffect {
  className: string;
}

/** Host-rendered status that temporarily replaces a thread's draft glyph. */
export interface PluginComposerThreadRowStatus {
  /**
   * Always drawn as given: unlike the plugin-badged surfaces, this one has no
   * preference for the plugin's own `bb.branding.icon`.
   */
  icon: BbIconName;
  /** Accessible label for the status glyph. */
  label: string;
  /**
   * Semantic host treatment for the status glyph. `running` automatically
   * shimmers; terminal `success` and `error` tones are static. Defaults to the
   * neutral tone.
   */
  tone?: "default" | "running" | "success" | "error";
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
 * One composer: its state and the writes a plugin can make. `useComposer()`
 * returns the composer the calling surface belongs to — inside a composer
 * slot, that composer; in a thread's panels, that thread's composer;
 * elsewhere, the current route's draft (the thread in view, or the new-thread
 * draft).
 *
 * The handle is stable: the same composer returns the same object across
 * renders, and its methods always act on the current draft, so it is safe to
 * keep in effects, callbacks and async work. Its reactive fields (`text`,
 * `draft`, `selection`, `isEmpty`, …) re-render the calling component when they change;
 * depend on those fields, not on the handle, in memo dependency lists.
 *
 * A handle always writes to its own composer's draft. Thread and new-thread
 * drafts persist, so a write after the composer left the screen still lands
 * in that draft. When the draft no longer exists (a queued-message or
 * sent-message editor that closed), `insert`, `replace`, `removeMention`, `submit` and
 * `setSelection` throw "This composer is no longer available"; the older
 * text methods log a warning and do nothing.
 */
export interface PluginComposerApi {
  /** Open this plugin's registered composer popup by popup id in this mounted composer. Returns false for an unavailable, suppressed or out-of-scope popup. */
  experimental_openPopup(popupId: string): boolean;
  /** Close this plugin's open popup in this composer and restore editor focus. Returns false if this plugin has no open popup. */
  experimental_closePopup(): boolean;
  scope: PluginComposerScope;
  /**
   * Stable identity for this composer's draft: the same across remounts and
   * reloads for thread and new-thread composers (including a `ThreadChat`),
   * and per editing session for queued-message and sent-message editors.
   */
  readonly key: string;
  /** `"compact"` in the collapsed single-line layout, otherwise `"expanded"`. */
  readonly layout: "expanded" | "compact";
  /** The thread's agent is running or stopping. Always false in a new-thread composer. */
  readonly isRunning: boolean;
  /** The composer is submitting right now. */
  readonly isSubmitting: boolean;
  /**
   * Pressing Enter would not submit right now: the same decision as the
   * host's send button (empty draft, uploads in progress, loading, a
   * selection or setup missing, a pending interaction, voice input, …).
   */
  readonly isSubmittingBlocked: boolean;
  /** The host's message for why submitting is blocked, or null when it is not. */
  readonly submittingBlockedReason: string | null;
  /** No text (ignoring whitespace), no mentions and no attachments. */
  readonly isEmpty: boolean;
  /** Attachments that have finished uploading. */
  readonly attachmentCount: number;
  /** Current plain text for this composer scope. */
  readonly text: string;
  /** The complete current draft, including uploaded attachments. Stable until the draft changes. */
  readonly draft: ComposerDraftSnapshot;
  /** Current picker values, or null when this composer has no pickers. Stable until a picker value changes. */
  readonly selection: ComposerSelection | null;
  /**
   * Replace text and mentions together in one committed change. An updater
   * receives the latest immutable snapshot, including attachments, and must
   * return its result synchronously. Returning that same snapshot is a no-op.
   * Omitted attachments are preserved; an explicit list replaces them, and
   * an empty list clears them. Does not infer or rebase mention ranges.
   * Ranges are non-overlapping UTF-16 offsets into the supplied text.
   * Invalid results, throwing updaters, and unavailable editors leave the
   * draft unchanged. Source project references on uploaded attachments are
   * preserved; core copies them into the destination project when the draft
   * is submitted. Does not focus or submit. Use `insert` for insertion at the
   * editor's cursor.
   */
  replace(
    next:
      | ComposerDraftReplacement
      | ((current: ComposerDraftSnapshot) => ComposerDraftReplacement),
  ): void;

  /**
   * @internal Legacy text replacement; retained at runtime for older plugins.
   * @deprecated Use `replace` with explicit text and mentions. This legacy method reconciles mentions automatically.
   * Replace the draft's plain text. Attachments are preserved. Inline mentions
   * outside the changed range are preserved and rebased; mentions overlapped
   * by the replacement are removed because their text representation changed.
   */
  setText(next: string): void;
  /**
   * @internal Legacy text updater; retained at runtime for older plugins.
   * @deprecated Use `replace(current => next)` with explicit mention ranges.
   * Replace the draft's plain text from the latest committed value. Uses the
   * same structured-state reconciliation as `setText`.
   */
  updateText(updater: (current: string) => string): void;
  /**
   * @internal Legacy text clearing; retained at runtime for older plugins.
   * @deprecated Use `replace({ text: "", mentions: [] })`. Attachments are preserved.
   */
  clear(): void;
  /**
   * Insert text and mentions. See {@link ComposerInsertOptions} for placement.
   * Mentions read from `draft` are recreated exactly; the calling plugin's
   * own `{ provider, id, label }` resolves through its mention provider.
   * Throws for another plugin's mention without `kind`, and for
   * `at: "cursor"` when the composer is not on screen.
   */
  insert(
    parts: ComposerInsertPart | readonly ComposerInsertPart[],
    options?: ComposerInsertOptions,
  ): void;
  /**
   * Apply a host-rendered effect to this composer's editable text, or clear it.
   * Effects are scoped to the calling plugin and automatically clear when the
   * slot unmounts or its composer scope changes.
   */
  setTextEffect(effect: PluginComposerTextEffect | null): void;
  /**
   * Lock or unlock editing for this composer. Locks are scoped to the calling
   * plugin and automatically release when the slot unmounts or its composer
   * scope changes.
   */
  setInputLock(locked: boolean): void;
  /**
   * @internal Legacy quoting method; retained at runtime for older plugins.
   * Append text to the draft as a `> ` blockquote block and focus the
   * composer. Blank text is a no-op. This is the "reference this selection
   * in chat" primitive.
   */
  addQuote(text: string): void;
  /**
   * @internal Legacy mention insertion; retained at runtime for older plugins.
   * Append an @-mention pill that resolves through this plugin's mention
   * provider at send time. `insert` places mentions at the cursor instead.
   */
  insertMention(mention: PluginComposerMention): void;
  /** @internal Legacy mention removal; retained at runtime for older plugins. */
  removeMention(mention: { provider: string; id: string }): void;
  /** Subscribe to successful local submissions in this composer scope, including accepted queued messages. Failed sends and draft clearing do not notify. Dispose on unmount. */
  onSubmitted(listener: () => void): () => void;
  /** Focus the composer caret at the end of the draft. */
  focus(): void;
  /**
   * Submit this composer's draft through the composer's own send and steer
   * handlers, the ones Enter and modifier+Enter run, including a
   * provider handoff that creates a new thread. The draft's attachments and
   * @-mentions, and — in the new-thread composer — the provider, model,
   * reasoning level, service tier, permission mode and environment the user
   * has selected on screen, all travel with it.
   *
   * It submits only the draft, so it rejects an empty one, even where the
   * shortcut would steer the next queued message instead. Otherwise it runs
   * only when the matching shortcut would. While attachments are uploading it
   * waits for them, then checks again; it rejects if an upload fails. When
   * the shortcut could not submit, it rejects with the reason, a message safe
   * to show to the user. The composer must be on screen. The queued-message
   * and sent-message editors reject.
   *
   * Every option combines with the others. `experimental_mode` uses the
   * names `bb.sdk.threads.send` uses. Without it, submit does what Enter
   * does for this user, which may be to queue or to steer.
   * `"queue-if-active"` queues behind the running turn, or starts a turn.
   * `"steer-if-active"` adds the message to the running turn. Where nothing
   * can be steered, such as on an idle thread, it starts a turn.
   * `sendAt` makes the chosen action wait until the given time; a scheduled
   * steer steers whatever turn is running then. `experimental_data` is
   * opaque JSON delivered to dispatch hooks together with the calling
   * plugin's id on this initial attempt. Hooks run before operational core
   * waits. If a hook queues the message, its existing plugin wait identifies
   * the owner on later attempts; core does not persist or interpret the
   * opaque data.
   *
   * Resolves once the composer has accepted the submission and cleared the
   * draft. Failures of the underlying request show bb's usual error toast
   * and restore the draft, exactly as an interactive failure does, and then
   * reject with the toast's message.
   */
  submit(options?: ComposerSubmitOptions): Promise<void>;
  /**
   * Set this composer's pickers as if each value had been picked by hand.
   *
   * Every field is optional. An omitted field is left alone. A field this
   * composer has no picker for is ignored rather than rejected: a thread
   * composer has no project or environment; a provider without service tiers
   * has no tier; a fork draft locks its project, provider and environment.
   * Values travel through the same paths the pickers use, so in the
   * new-thread composer they become the remembered defaults for the next
   * thread and are reported as the user's explicit choices, and in a thread
   * composer a provider change starts the same handoff the picker starts:
   * the handoff block is prepended to the draft and the next send creates a
   * new thread. A same-provider model change in a thread does not start a
   * handoff, exactly like the picker.
   *
   * In the new-thread composer the project is switched first and awaited
   * (attachments are copied to the new project), then the environment and
   * machine are applied to the new project, then provider, model, reasoning
   * level, service tier and permission mode. A provider change reloads the
   * model catalog before the model and reasoning level are applied to it.
   * Because the project switch remounts plugin surfaces, the returned
   * promise is owned by the composer and still resolves after the calling
   * component has unmounted.
   *
   * Resolves with the composer's own selection once it has settled: the
   * applied values have committed and the model catalog for the selected
   * provider and machine has finished loading, so model, reasoning level and
   * permission mode have reconciled against it. The catalog wait is bounded;
   * if it has not finished after 15 seconds the promise resolves with the
   * selection as it stands. The result carries only the fields this composer
   * has, so a missing key means "no such picker here" and a value that
   * differs from the one passed was reconciled (a reasoning level the model
   * does not support, a service tier the model does not offer, a permission
   * mode above the machine's ceiling, a model the provider does not list). A provider the composer does not list is
   * ignored together with the model and reasoning level meant for it, so the
   * stored provider preference never names something the picker could not
   * have chosen. `environment` is absent while the composer
   * has no submittable environment; `providerId` and `model` are absent
   * while nothing is selected; `serviceTier` is present only when the
   * selected provider has tiers and one is chosen.
   *
   * Rejects, with a message safe to show to the user, in a composer with no
   * pickers at all (a queued-message editor, a side chat, a plugin surface
   * mounted outside any composer), when the calling surface is no longer
   * active, and when a value is not a known reasoning level or permission
   * mode, or is an empty service tier.
   */
  setSelection(selection: ComposerSelection): Promise<ComposerSelection>;
  /** @internal Old name of `removeMention`; kept for plugins built against older SDKs. */
  experimental_removeMention(mention: { provider: string; id: string }): void;
  /** @internal Old name of `onSubmitted`; kept for plugins built against older SDKs. */
  experimental_onSubmitted(listener: () => void): () => void;
  /** @internal Old name of `submit`; kept for plugins built against older SDKs. */
  experimental_submit(options: ComposerSubmitOptions): Promise<void>;
  /** @internal Old name of `setSelection`; kept for plugins built against older SDKs. */
  experimental_setSelection(
    selection: ComposerSelection,
  ): Promise<ComposerSelection>;
}

/**
 * Current picker values in `selection`, input for `setSelection`, and the shape it resolves with. Field names match `NewThreadRequest` and the `default*` props of
 * `experimental_NewThreadComposer`, so one routed decision can feed the
 * composer, the embedded composer and `bb.sdk.threads.spawn` alike.
 */
export interface ComposerSelection {
  /** New-thread composers only. BB's personal-project id means "Don't work in a project". */
  projectId?: string;
  /**
   * New-thread composers only. `{ type: "project-default" }` and a `host`
   * environment without a `hostId` seed nothing and are ignored. Provider
   * `inputs` are not applied; the provider's own inputs control keeps its
   * value, and the result reports what the composer would submit.
   */
  environment?: CreateThreadEnvironmentArgs;
  /** A provider the composer does not list is ignored, and `model` and `reasoningLevel` with it. */
  providerId?: string;
  /** Applied only when the composer ends up on the requested provider (or none was requested). */
  model?: string;
  /** Applied only when the composer ends up on the requested provider (or none was requested). */
  reasoningLevel?: ReasoningLevel;
  /**
   * A tier id the provider declares (`"default"`, `"fast"`, …). Ignored by a
   * provider with no service tiers; a tier the selected model does not offer
   * becomes `"default"`.
   */
  serviceTier?: ServiceTier;
  permissionMode?: PermissionMode;
}

/** What `submit` adds to pressing Enter. Every field combines with the others. */
export interface ComposerSubmitOptions {
  /**
   * `"queue-if-active"` queues behind the running turn and
   * `"steer-if-active"` adds to it; both start a turn when none is running.
   * Omitted, it does what Enter does for this user.
   */
  experimental_mode?: "queue-if-active" | "steer-if-active";
  /** Epoch ms in the future; the action waits until then. */
  sendAt?: number;
  /**
   * Opaque JSON delivered to dispatch hooks with the calling plugin's id on
   * the initial dispatch attempt.
   */
  experimental_data?: JsonValue;
}

/** @internal Old name of {@link ComposerSelection}. */
export type ExperimentalComposerSelection = ComposerSelection;
/** @internal Old name of {@link ComposerSubmitOptions}. */
export type ExperimentalComposerSubmitOptions = ComposerSubmitOptions;

// ---------------------------------------------------------------------------
// ThreadChat — the host-owned chat component.
// ---------------------------------------------------------------------------

/**
 * A consumer-supplied action on the messages of one `ThreadChat` instance,
 * rendered in the embedded timeline's per-message action bar alongside the
 * native actions. Slot-registered `messageAction`s do not appear there. Unlike
 * the `messageAction` slot this is scoped to the rendering component, not
 * registered globally.
 */
export interface ThreadChatMessageAction {
  /** Unique within this ThreadChat instance; letters, digits, `-`, `_`. */
  id: string;
  /** Tooltip / menu label for the action. */
  title: string;
  icon?: BbIconName;
  /**
   * Message roles the action applies to. Omitted = both user and assistant
   * messages.
   */
  roles?: readonly ("user" | "assistant")[];
  /**
   * Runs when the user activates the action. Errors (sync or async) are
   * contained and logged; they never break the timeline.
   */
  run(message: ThreadChatMessageReference): void | Promise<void>;
}

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
  /**
   * Who controls the permission mode sends run with. "inherit" (default)
   * pins every send to the thread's own resolved default and renders the
   * picker as a dimmed label — a plugin surface can never widen it.
   * "editable" gives this chat its own picker, so the user can raise or
   * lower permissions for this thread independently of the thread it was
   * forked from. Ignored by `variant: "timeline"` (no composer).
   */
  permissionPolicy?: "inherit" | "editable";
  className?: string;
  /** Rendered above the conversation, scrolling with it. */
  leadingContent?: ReactNode;
  /**
   * Actions rendered in this instance's per-message action bar (see
   * {@link ThreadChatMessageAction}).
   */
  messageActions?: readonly ThreadChatMessageAction[];
}

// ---------------------------------------------------------------------------
// experimental_ProviderModelPicker — host-owned execution selection.
// ---------------------------------------------------------------------------

/**
 * The controlled execution selection resolved by the picker.
 *
 * Deliberately a single concrete shape, not a union: this value exists to be
 * forwarded verbatim to `bb.sdk.threads.spawn`, so it must name a real
 * provider and model.
 */
export interface ExperimentalProviderModelPickerValue {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  /**
   * Present only when the selected provider supports service tiers. A tier
   * id the provider declares; `"default"` when the selected model offers none.
   */
  serviceTier?: ServiceTier;
}

/** Where the picker resolves the live provider and model catalog. */
export type ExperimentalProviderModelPickerRouting =
  | { kind: "host"; hostId: string }
  | { kind: "environment"; environmentId: string };

/**
 * Props of the host-owned `experimental_ProviderModelPicker` component.
 * Provider switches emit one coherent value after the live catalog resolves
 * its default model, reasoning level, and service-tier capability. Failed or
 * empty catalogs leave `value` unchanged. Omit `routing` to use bb's
 * primary-machine routing. Environment routing is required when a provider's
 * model catalog depends on the selected workspace.
 */
export interface ExperimentalProviderModelPickerProps {
  value: ExperimentalProviderModelPickerValue;
  onChange(value: ExperimentalProviderModelPickerValue): void;
  /** Route discovery through an explicit machine or existing environment. */
  routing?: ExperimentalProviderModelPickerRouting;
  /** Allow switching providers. Defaults to true; false hides provider tabs. */
  allowProviderChange?: boolean;
  /** Horizontal popover alignment. Defaults to `"start"`. */
  align?: "start" | "center" | "end";
  /** Render the shared selection summary without allowing changes. */
  disabled?: boolean;
  className?: string;
}

/**
 * Props of the host-owned `experimental_BranchPicker` component — bb's branch
 * picker bundled with its branch-options loading for the given host and
 * project. The host owns fetching, searching, and refreshing the branch list;
 * the caller owns the selection and its meaning.
 */
export interface BranchPickerProps {
  /**
   * The enrolled machine whose project checkout supplies the branch list.
   * Null renders the picker disabled with no options.
   */
  hostId: string | null;
  /** The project whose source on `hostId` is listed; null disables loading. */
  projectId: string | null;
  /**
   * The selected branch name, or null when no branch is chosen. A null value
   * shows the placeholder without selecting or implying a default branch.
   */
  value: string | null;
  /** Called with the picked branch name, or null when the pick is cleared. */
  onChange(next: string | null): void;
  /**
   * Text placed before the branch on the trigger and used as the menu heading,
   * e.g. "Compare with:". Omitted, the trigger is the branch alone and the menu
   * uses the neutral "Branches" heading.
   */
  label?: string;
  /**
   * The complete trigger text while nothing is picked, without the label
   * prefix. Defaults to "Select branch".
   */
  placeholder?: string;
  /** Render the current selection without allowing changes. */
  disabled?: boolean;
}

export interface UseBranchesArgs {
  hostId: string | null;
  projectId: string | null;
  query?: string;
}

export interface BranchesState {
  branches: readonly string[];
  remoteBranches: readonly string[];
  isLoading: boolean;
  refresh(): Promise<void>;
}

export interface UseCheckoutStateArgs {
  hostId: string | null;
  projectId: string | null;
}

export interface CheckoutState {
  isGit: boolean | null;
  unborn: boolean;
  detached: boolean;
  dirty: boolean;
  currentBranch: string | null;
  operation: WorkspaceGitOperation;
}

/** Props of BB's controlled, host-resolved permission-mode picker. */
export interface ExperimentalPermissionModePickerProps {
  /** Provider whose supported modes determine the available choices. */
  providerId: string;
  value: PermissionMode;
  onChange(value: PermissionMode): void;
  /** Route capability and machine-ceiling resolution like the execution picker. */
  routing?: ExperimentalProviderModelPickerRouting;
  /** Horizontal menu alignment. Defaults to `"end"`. */
  align?: "start" | "center" | "end";
  /** Render the resolved mode without allowing changes. */
  disabled?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// experimental_NewThreadComposer — the host-owned new-thread compose surface.
// ---------------------------------------------------------------------------

/**
 * Every selection the composer resolved, JSON-serializable so a plugin can
 * forward it to its own backend rpc verbatim and hand it straight to
 * `bb.sdk.threads.spawn`.
 *
 * The split is deliberate: the composer owns *user selections*, the plugin
 * owns *filing and attribution*. `bb.sdk.threads.spawn` auto-fills
 * `origin: "plugin"` and `originPluginId`, so a thread created this way stays
 * attributed to the plugin — which it would not be if the component created
 * the thread itself. The plugin adds `sectionId`, `parentThreadId`, `title`,
 * and `visibility` to the request on its own; they are deliberately not
 * composer props.
 */
export interface NewThreadRequest {
  /**
   * The selected project id. Choosing "Don't work in a project" submits BB's
   * personal-project id (not `null`) together with a `personal` workspace
   * environment. Forward those fields unchanged to `threads.spawn`; if the
   * plugin needs project metadata, request it from the plugin backend with
   * `bb.sdk.projects.list({ includePersonal: true })`.
   */
  projectId: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  /** Omitted when the selected provider has no service tiers. */
  serviceTier?: ServiceTier;
  /**
   * Agent options the user chose in the model picker or the mode menu, keyed
   * by option id. Present only when the user changed at least one option the
   * selected provider declares. Forward it to `threads.spawn` unchanged.
   */
  sessionOptions?: SessionOptionSelections;
  /**
   * Per-field provenance (caller-explicit vs. default) for the execution
   * options above, forwarded to `spawn` so the server records what the user
   * actually chose.
   */
  executionInputSources: CreateExecutionInputSources;
  environment: CreateThreadEnvironmentArgs;
  input: PromptInput[];
  /**
   * Epoch ms the first turn should dispatch at. Present only when the
   * submission came from `useComposer().submit` — a scheduled
   * create — and absent otherwise, which is what makes an ordinary submission
   * start work at once. Forward it to `threads.spawn` unchanged: the thread is
   * created `pending` and its first message is queued as a row until then.
   */
  sendAt?: number;
}

/**
 * Props of the host-owned `experimental_NewThreadComposer` component — bb's
 * full new-thread compose surface (prompt editor with @-mentions and expand,
 * attachments, provider/model/reasoning picker, voice, submit, and the row
 * beneath with project, environment, branch-from, and permission mode),
 * rendered by the BB app inside a plugin slot.
 *
 * It is the create-side counterpart to `ThreadChat`: same deliberate
 * exception to the no-host-components rule (§5.5), same additive versioning.
 */
export interface NewThreadComposerProps {
  /**
   * Seeds the project picker. The user can change it, including choosing
   * "Don't work in a project"; see {@link NewThreadRequest.projectId} for the
   * submitted projectless shape.
   */
  defaultProjectId?: string;
  /**
   * Seeds the provider picker. Like every `default*` prop this is a SEED, not
   * a controlled value: the composer stays uncontrolled, the user can change
   * it, and when omitted the composer falls back to the project's remembered
   * execution defaults exactly as before. When provided it takes precedence
   * over those project defaults.
   *
   * Re-seeding: the `default*` props are value-compared each render. When any
   * of them changes after mount, the composer re-seeds EVERY execution and
   * environment selection from the new props — including selections the user
   * had already touched — so switching between two saved records in the same
   * mounted composer reloads that record's values (the same rule
   * `defaultProjectId` already follows).
   *
   * Every seeded field is reported as caller-explicit in the submitted
   * request's `executionInputSources`. That is what makes the seed survive
   * `threads.spawn`: the server drops a requested `providerId`/`model` that
   * carries no provenance source and re-derives it from the project's stored
   * defaults, which would silently undo the seed.
   */
  defaultProviderId?: string;
  /** Seeds the model picker. Same seed semantics as {@link defaultProviderId}. */
  defaultModel?: string;
  /**
   * Seeds the reasoning-level picker. Same seed semantics as
   * {@link defaultProviderId}. If the seeded model does not support this
   * level, the composer reconciles to the closest supported one.
   */
  defaultReasoningLevel?: ReasoningLevel;
  /**
   * Seeds the service-tier picker. Same seed semantics as
   * {@link defaultProviderId}. Ignored (and omitted from the submitted
   * request) when the selected provider has no service tiers.
   */
  defaultServiceTier?: ServiceTier;
  /** Seeds the permission-mode picker. Same seed semantics as {@link defaultProviderId}. */
  defaultPermissionMode?: PermissionMode;
  /**
   * Seeds the environment and branch pickers from a previously submitted
   * `NewThreadRequest.environment`. Same seed semantics as
   * {@link defaultProviderId}: a seed the user can change, taking precedence
   * over the composer's own environment default when provided.
   *
   * Round trip: feeding a submitted request's `environment` back in and
   * resubmitting untouched reproduces an equivalent environment, with these
   * documented limits — the composer cannot represent every args variant:
   *
   * - `{ type: "project-default" }` seeds nothing; the composer resolves its
   *   own default and submits that concrete environment instead.
   * - A `host` environment whose host no longer exists (or whose project has
   *   no source on it) falls back to the composer's default host, exactly as
   *   the primary compose surface would.
   * - A `reuse` environment whose worktree no longer has unarchived threads
   *   falls back the same way.
   * - An `unmanaged` workspace's `path` has no composer control; the seeded
   *   selection submits `path: null` (the host's configured checkout). The
   *   composer itself never produces a non-null `path`, so real round trips
   *   are unaffected.
   * - A `managed-worktree` with `baseBranch: { kind: "default" }` leaves the
   *   branch picker on its default, which may resolve to a named base branch
   *   when the project configures a dedicated worktree base — the same branch
   *   the original `default` submission would have created from.
   */
  defaultEnvironment?: CreateThreadEnvironmentArgs;
  /**
   * Seeds the draft, only while the draft is still empty. Serialized
   * `@thread:<id>`, `@project:<id>`, and `@section:<id>` tokens become mention
   * pills with host-resolved titles/names. Missing projects/sections use their
   * IDs; unavailable generated thread IDs use "Unavailable thread" ("Thread"
   * if lookup fails). Other unknown thread IDs use the ID as their label.
   */
  initialPrompt?: string;
  placeholder?: string;
  /**
   * "contained" (default) fills and scrolls inside a bounded parent;
   * "document" grows with its content and defers scrolling to the page.
   */
  layout?: "contained" | "document";
  /** Bump to focus the editor. */
  focusRequest?: number;
  className?: string;
  /**
   * Where the draft persists. Drafts survive reloads and are shared by every
   * composer using the same key; defaults to a key scoped to this plugin.
   */
  draftKey?: string;
  /**
   * Fires on submit with every selection resolved. The draft clears when this
   * resolves and is KEPT if it throws, so a failed create never loses what the
   * user typed.
   */
  onSubmit: (request: NewThreadRequest) => void | Promise<void>;
}

/**
 * Props of the host-owned `Markdown` component — bb's chat message renderer
 * (the same typography, spacing, and code styling as timeline messages).
 * Use it wherever plugin UI quotes or previews message content so it reads
 * like the rest of the chat. Like `ThreadChat`, this is a stable product
 * capability, not a UI kit; renderer internals stay private.
 */
export interface MarkdownProps {
  /** Markdown source, rendered exactly like a chat message body. */
  content: string;
  className?: string;
  /** Resolve local destinations from this document; omission keeps message routing. */
  experimental_document?: {
    threadId: string;
    rootPath: string;
    target: Exclude<ExperimentalLiveFileTarget, { kind: "host" }>;
  };
}

/**
 * Props for BB's semantic URL link. The host owns ordinary activation while
 * retaining browser-owned anchor behavior for app routes, modifiers, explicit
 * targets, copying, and unsupported schemes. New top-level targets preserve
 * supplied `rel` tokens and receive safe defaults unless `opener` is explicit.
 * Experimental: see docs/api_to_audit.md.
 */
export interface UrlLinkProps extends Omit<
  ComponentPropsWithoutRef<"a">,
  "href"
> {
  href: string;
}

/** A live file whose identity is complete without ambient route context. */
export type ExperimentalLiveFileTarget =
  | {
      kind: "workspace";
      environmentId: string;
      path: string;
      /**
       * Git revision to read instead of the working copy: `"HEAD"` or a 4–40
       * character commit SHA; other values make the target invalid. Previews
       * open read-only and are labelled with the ref; external opens ignore it
       * and open the working copy.
       */
      experimental_ref?: string;
    }
  | { kind: "host"; hostId: string; path: string }
  | { kind: "thread-storage"; threadId: string; path: string };

/** One-based location to reveal after a live file opens. */
export type ExperimentalFileLocation =
  | { kind: "line"; line: number; column: number | null }
  | { kind: "range"; startLine: number; endLine: number };

/** Options shared by BB's preview and preferred-external file intents. */
export interface ExperimentalFileOpenOptions {
  target: ExperimentalLiveFileTarget;
  location: ExperimentalFileLocation | null;
}

/**
 * Props for BB's host-rendered semantic file link. Valid targets receive a
 * scheme-safe anchor href; traversal paths, ill-formed Unicode, and other
 * malformed runtime targets remain inert.
 */
export interface ExperimentalFileLinkProps extends Omit<
  ComponentPropsWithoutRef<"a">,
  "href" | "target"
> {
  target: ExperimentalLiveFileTarget;
  location?: ExperimentalFileLocation | null;
}

/**
 * The owning fixed tab's current memory-only target. It survives tab, panel,
 * and route remounts during the current app session, but is never persisted
 * across a refresh. Call `clear` when the owner returns to its untargeted state.
 */
export interface ExperimentalFixedTabTargetState<Target extends JsonValue> {
  readonly sequence: number;
  readonly target: Target;
  clear(): void;
}

/** A fixed tab with an owner-validated target. */
export type ExperimentalTabTargetReference<Target extends JsonValue> =
  ExperimentalTabReference & {
    availability: "fixed";
    experimental_target: ExperimentalFixedTabTargetContract<Target>;
  };

/**
 * A registered tab of the calling plugin to open on the current surface.
 * Fixed tabs accept a session-only `target`, validated by the tab's
 * `experimental_target`. Action tabs accept persisted `params`, which
 * identify the instance (opening with the same params focuses the existing
 * tab), and a `title`.
 */
export type ExperimentalOpenTabOptions =
  | {
      tab: ExperimentalTabReference & { availability: "fixed" };
      target?: JsonValue;
      params?: never;
      title?: never;
    }
  | {
      tab: ExperimentalTabReference & { availability: "action" };
      params?: JsonValue;
      title?: string;
      target?: never;
    };

/**
 * The side panel of one surface: a thread view, a plugin page, or the New
 * thread screen. Every call returns true when the host accepted it and false
 * when it declined: the surface has no side panel, the tab is not registered
 * by this plugin for this surface or is hidden, or `target`/`params` is not
 * a JSON value or fails the tab's validator. A decline is never thrown.
 */
export interface ExperimentalPanelController {
  /** Select the tab and reveal the side panel. */
  openTab(options: ExperimentalOpenTabOptions): boolean;
  /**
   * Close the side panel if this tab is showing — a fixed tab selected with
   * the panel open (`target` is ignored), or the action tab instance with the
   * same `params` selected — otherwise `openTab(options)`.
   */
  toggleTab(options: ExperimentalOpenTabOptions): boolean;
  /** Close the side panel. */
  close(): boolean;
}

/** Current app selection, derived from the route. */
export interface BbContext {
  projectId: string | null;
  threadId: string | null;
}

export interface BbNavigate {
  /**
   * Open a thread. `split: true` applies bb's split placement rules (a right
   * split by default, focus when already open, replace at the pane cap) and
   * falls back to plain navigation where splits are off. Opening also expands
   * the thread's conversation if the side panel had collapsed it.
   */
  toThread(threadId: string, options?: { split?: boolean }): void;
  toProject(projectId: string): void;
  /**
   * Navigate to one of this plugin's own nav panels by its `path`.
   * `subPath` targets a location inside the panel as unencoded
   * `/`-separated segments; the component's `subPath` prop receives them
   * percent-encoded. `replace` swaps the current history entry instead of
   * pushing — use it for redirects so back does not bounce.
   */
  toPluginPanel(
    path: string,
    options?: { subPath?: string; replace?: boolean },
  ): void;
  /**
   * Navigate to the root compose surface (the new-thread screen). Pass
   * `initialPrompt` to seed the composer draft (serialized thread, project,
   * and section mention tokens become pills) and `focusPrompt` to focus the
   * composer on arrival — the pairing behind "Create via chat" style entry
   * points that drop the user into chat with a prefilled prompt.
   * `projectId` makes that project the composer's selection; `placement`
   * files the new thread in a section and pin state (omitted: unpinned,
   * outside sections); `environmentId` reuses that environment and `hostId`
   * picks a machine for a new one (`environmentId` wins when both are set).
   */
  toCompose(options?: {
    projectId?: string;
    initialPrompt?: string;
    focusPrompt?: boolean;
    placement?: { sectionId: string | null; pinned: boolean };
    environmentId?: string;
    hostId?: string;
  }): void;
  /**
   * Open an HTTP(S) URL using this client's BB browser preference, or request
   * an application link on this device with confirmation unless its scheme is approved when
   * the applicationLinks experiment is enabled. Returns false
   * for blocked or unsupported schemes. True means handled, not launched. See
   * docs/api_to_audit.md.
   */
  openUrl(url: string): boolean;
  /** Open a live file in this surface's shared BB preview panel. */
  experimental_openFilePreview(options: ExperimentalFileOpenOptions): boolean;
  /** Open a live file in this client's preferred external file target. */
  experimental_openFileExternally(
    options: ExperimentalFileOpenOptions,
  ): boolean;
  /**
   * Show a terminal session in this surface's BB terminal panel: select its
   * tab, adding one when needed, and reveal the panel. Create the session
   * first with `useSdk().terminals.create`, whose scope chooses the thread,
   * environment, or host directory it runs in. A thread surface accepts only
   * that thread's terminals, the New thread screen only terminals in its
   * current terminal scope, and a plugin page any terminal. Resolves false
   * for unknown or exited terminals and surfaces without a terminal panel.
   * Closing the tab closes the terminal. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_openTerminal(options: { terminalId: string }): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// The whole runtime surface. Declaration-versus-runtime parity is tested
// against the actual `@get-bb/plugin-sdk/app` module namespace.
//
// Components are deliberately NOT part of this surface (removed 2026-07-03,
// plugin design §5.5): plugins vendor shadcn-style component source from the
// BB registry (`npx shadcn add @bb/<name>`) and own it. `bb plugin build`
// shims react, the shared-singleton packages (portal radix families,
// sonner, vaul, @pierre/diffs) and the host-resident libraries every plugin
// would otherwise duplicate (clsx, tailwind-merge, class-variance-authority,
// the shared-ui icon); everything else bundles per plugin. Freezing 65
// component prop types here made every host component change a
// plugin-breaking change.
// ---------------------------------------------------------------------------

/**
 * BB live reads are fresh for two seconds, with no polling when freshness expires.
 * Focus does not refetch while BB's realtime connection is healthy. While
 * disconnected, focus/browser-online events recheck stale active reads; BB
 * reconnect invalidates all plugin reads regardless of freshness. Page hiding
 * cancels active attempts; resuming restarts those cancelled reads.
 * Invalidations refresh immediately. Network/abort failures retry twice at
 * 250 ms; HTTP failures, including refusals, do not retry. Writes never retry
 * automatically.
 */
export interface ExperimentalRpcQueryState<T> {
  /** Latest successful value plus shared predictions; retained during refresh and refresh errors. Plain reads are undefined before first success; keyed reads expose loaded rows (initially an empty record) through select. */
  data: T | undefined;
  /** Last completed read failure, or null. Success clears it; retrying a first load clears the old error while loading. Refresh errors preserve data. */
  error: experimental_PluginRpcCallError | null;
  /** An enabled read is fetching data it has never loaded. For keyed reads this includes missing requested rows; empty/disabled keyed reads are not loading. */
  isLoading: boolean;
  /** A read attempt is active, including background refreshes. Keyed consumers share this activity for their method; offline-paused reads are not fetching. */
  isFetching: boolean;
  /** Force a read regardless of freshness and wait for its attempt/retries. Keyed reads refresh only this hook's keys, batched with other hooks refreshing in the same render. Failures update error and retain data; this promise resolves rather than rejecting. */
  refetch(): Promise<void>;
}

export interface ExperimentalRpcKeyedQueryState<
  T,
  Selection = Record<string, T>,
> extends ExperimentalRpcQueryState<Selection> {
  /**
   * Read these keys again and keep every other loaded row, for retrying one
   * failed row without refreshing the rest. Keys must be among this query's
   * keys; others are ignored. Resolves once the read settles; failures update
   * `error` and retain data.
   */
  refetchKeys(keys: readonly string[]): Promise<void>;
}

export interface ExperimentalRpcQueryOptions<
  Contract extends PluginRpcContract,
  Method extends keyof Contract & string,
> {
  contract: Contract;
  pluginId?: string;
  method: Method;
  input: StandardSchemaV1InferInput<Contract[Method]["input"]>;
  enabled?: boolean;
}

/**
 * Predict loaded reads with pure, synchronous update callbacks. Callbacks passed
 * to `update` and `updateKey` may run many times as pending predictions replay
 * over a new confirmed base or another prediction rolls back. Return a new
 * value without mutating `current` or captured inputs, performing side effects,
 * or generating IDs, timestamps, or random values. Generate any such values
 * once before calling `mutate` and include them in the mutation input.
 */
export interface ExperimentalRpcOptimisticCache<
  Contract extends PluginRpcContract,
> {
  update<Method extends keyof Contract & string>(
    method: Method,
    input: StandardSchemaV1InferInput<Contract[Method]["input"]>,
    update: (
      current: PluginRpcResult<Contract[Method]>,
    ) => PluginRpcResult<Contract[Method]>,
  ): void;
  updateKey<Method extends ExperimentalRpcKeyedMethod<Contract>>(
    method: Method,
    key: string,
    update: (
      current: PluginRpcResult<Contract[Method]> extends Record<
        string,
        infer Value
      >
        ? Value
        : never,
    ) => PluginRpcResult<Contract[Method]> extends Record<string, infer Value>
      ? Value
      : never,
  ): void;
}

export interface ExperimentalRpcMutationOptions<
  Contract extends PluginRpcContract,
  Method extends keyof Contract & string,
> {
  contract: Contract;
  pluginId?: string;
  method: Method;
  /** Predict loaded reads synchronously; shared predictions survive accepted writes whose refresh fails. */
  optimistic?(
    input: StandardSchemaV1InferInput<Contract[Method]["input"]>,
    cache: ExperimentalRpcOptimisticCache<Contract>,
  ): void;
}

/**
 * One mutation hook's state. `mutate` calls the RPC and resolves when the
 * server acknowledges the write. Reads refresh in the background when the
 * server marks their tags stale with `bb.rpc.experimental_invalidate`.
 * `error` holds the last failure until the next `mutate` or `reset`.
 */
export interface ExperimentalRpcMutationState<
  Method extends PluginRpcMethodContract,
> {
  /** Resolves at write acknowledgement; rejects with experimental_PluginRpcCallError. Refreshes continue in the background without releasing predictions before confirmed reads. */
  mutate(...args: PluginRpcCallArgs<Method>): Promise<PluginRpcResult<Method>>;
  isPending: boolean;
  /** Inputs of every pending call made by this hook, until server acknowledgement. Refreshes are excluded; other hook instances are excluded. */
  pendingInputs: readonly StandardSchemaV1InferInput<Method["input"]>[];
  error: experimental_PluginRpcCallError | null;
  reset(): void;
}

/**
 * Everything `@get-bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
export interface PluginSdkApp {
  /** List URL schemes approved for this BB site in the viewing client's localStorage. Core Settings uses the same implementation. */
  experimental_getApplicationLinkApprovals(): Promise<string[]>;
  /** Revoke one scheme, or all with null, for this BB site on this client. Does not grant permission. */
  experimental_revokeApplicationLinkApproval(
    scheme: string | null,
  ): Promise<string[]>;
  experimental_PluginRpcCallError: typeof experimental_PluginRpcCallError;
  experimental_useRpcRefresh(): { refresh(): void; isRefreshing: boolean };
  /** Read tagged plugin data through BB's shared query cache and realtime lifecycle. */
  experimental_useRpcQuery<
    Contract extends PluginRpcContract,
    Method extends keyof Contract & string,
  >(
    options: ExperimentalRpcQueryOptions<Contract, Method>,
  ): ExperimentalRpcQueryState<PluginRpcResult<Contract[Method]>>;
  /** Call a mutating RPC through BB's query client; pending until the server acknowledges the write; matched reads refresh in the background. */
  experimental_useRpcMutation<
    Contract extends PluginRpcContract,
    Method extends keyof Contract & string,
  >(
    options: ExperimentalRpcMutationOptions<Contract, Method>,
  ): ExperimentalRpcMutationState<Contract[Method]>;
  /** Cache each key independently and batch missing or invalidated keys in the same render. Each key is watched once while the hook holds it, so a changing key list subscribes only added keys and releases only removed ones. */
  experimental_useRpcKeyedQuery<
    Contract extends PluginRpcContract,
    Method extends ExperimentalRpcKeyedMethod<Contract>,
    Selection = Record<string, ExperimentalRpcKeyedValue<Contract[Method]>>,
  >(options: {
    contract: Contract;
    pluginId?: string;
    method: Method;
    keys: readonly string[];
    enabled?: boolean;
    /** Pure projection; the selection type is inferred from its return value. */
    select?(
      data: Record<string, ExperimentalRpcKeyedValue<Contract[Method]>>,
    ): Selection;
  }): ExperimentalRpcKeyedQueryState<
    ExperimentalRpcKeyedValue<Contract[Method]>,
    Selection
  >;

  experimental_Icon: ComponentType<ExperimentalIconProps>;
  /**
   * Render provider slot override, then its logo, then its glyph, then fallback.
   * Pass a record from agent, machine, or environment provider queries;
   * an id-only record resolves frontend registrations, without fetching metadata.
   * Updates on plugin load, reload and unload. Throwing or recursive overrides
   * fall back to declared artwork. Logo assets render as currentColor masks.
   */
  experimental_ProviderIcon: ComponentType<ExperimentalProviderIconProps>;
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
  /**
   * Whether the bb experiment `key` is on (Settings → Experiments,
   * `bb settings experiment <key>`), following live changes. False while the
   * app config loads and for keys this bb does not know. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_useExperiment(key: string): boolean;
  useBbContext(): BbContext;
  /**
   * The id of the plugin that owns the calling component: the same id
   * `bb.pluginId` reports on the server, derived from the package name. Key
   * state the plugin keeps outside bb's per-plugin storage with it, such as
   * localStorage entries and log prefixes, so a copy of the plugin published
   * under another name does not collide with the original. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_usePluginId(): string;
  /**
   * The answer shortcuts bb binds while a pending interaction is open. Inside
   * a `pendingInteraction` component the form shows each option's shortcut and
   * registers a handler that chooses the option; outside one, the map is empty
   * and handlers never run. Experimental: see docs/api_to_audit.md.
   */
  experimental_useQuestionFormHost(): ExperimentalQuestionFormHost;
  useBbNavigate(): BbNavigate;
  /**
   * Whether `useBbNavigate().experimental_openFileExternally` can open this
   * target now: it resolves to a path on its host (a ready environment, a
   * host, or thread storage) and this client has an external file target for
   * that host. False while either is loading; the component re-renders when
   * the answer changes. Experimental: see docs/api_to_audit.md.
   */
  experimental_useCanOpenFileExternally(
    target: ExperimentalLiveFileTarget,
  ): boolean;
  /**
   * Whether the panel tab this component renders in is showing: it is the
   * selected tab of its pane and the side panel is open. False while the panel
   * is closed or suppressed, while another tab is selected, and outside a
   * panel tab. bb keeps a closed panel's tab mounted, so pause reads that only
   * feed what the tab draws while this is false. Works in fixed and action
   * tabs. Experimental: see docs/api_to_audit.md.
   */
  experimental_useTabVisible(): boolean;
  /**
   * The side panel of the surface the calling component renders in: the
   * thread view, the plugin page, or the New thread screen.
   */
  experimental_useAppPanel(): ExperimentalPanelController;
  /** Read or clear the owning tab's validated, session-scoped target. */
  experimental_useFixedTabTarget<Target extends JsonValue>(
    tab:
      | ExperimentalTabTargetReference<Target>
      | ExperimentalPluginFixedTabReference<Target>,
  ): ExperimentalFixedTabTargetState<Target> | null;
  useComposer(): PluginComposerApi;
  /**
   * Every composer on screen that plugin composer customizations mount in,
   * oldest first: the thread page's composer, a `ThreadChat`'s composer, the
   * new-thread composer and open queued-message editors. Use it from a panel
   * or page that writes into a composer the user picks — label each by its
   * `scope`, then call `insert`, `focus` or `submit` on the chosen handle.
   *
   * Each handle is stable while its composer stays on screen and follows the
   * same lifetime rule as `useComposer()`. `setTextEffect` and `setInputLock`
   * have no effect here; call them from a composer slot's `useComposer()`.
   * The calling component re-renders when the list or any listed draft
   * changes.
   */
  useComposers(): readonly PluginComposerApi[];
  /**
   * The sidebar's live thread view (see {@link PluginSidebarThreadsState}).
   * Reads the host's own cache and realtime subscriptions, so it costs no
   * extra request and updates exactly when the built-in sidebar does.
   *
   * Active threads are uncapped. Opting into archived threads uses the host
   * archive query; request more pages through `experimental_archived`.
   * `threads` contains the selected lifecycles across loaded pages. Thread
   * objects keep their identity across updates while the underlying entry is
   * unchanged, so a memoized row re-renders only when its own thread changed;
   * the array itself is new on every update. Window your rows (render only
   * what is on screen) as the built-in sidebar does — a list that mounts one
   * row per thread is slow on phones with many threads.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useSidebarThreads(options?: {
    /** Defaults to active threads only. An empty selection also means active. */
    experimental_lifecycles: readonly ("active" | "archived")[];
  }): PluginSidebarThreadsState;
  /**
   * Thread actions bound to the host's mutations (see
   * {@link PluginSidebarThreadActions}). Experimental: see
   * docs/api_to_audit.md.
   *
   * @internal Superseded by `experimental_useThreadActions`, the thread
   * action components, `useSdk().threads`, and `useBbNavigate()`; kept for
   * plugins built against older SDKs.
   */
  experimental_useSidebarThreadActions(): PluginSidebarThreadActions;
  /**
   * Archive an environment's active thread trees the way bb's own list does:
   * optimistic removal, closing their split panes, leaving a route that shows
   * one of them, and one Undo toast that restores them and the route. The
   * promise rejects after bb has shown an error toast. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_useArchiveEnvironmentThreads(): (
    environmentId: string,
  ) => Promise<void>;
  /**
   * Every `"menu"` thread action for one thread, in menu order (see
   * {@link PluginThreadAction} for grouping): bb's own registrations first,
   * then plugins' in registration order. Registrations' `useData` hooks run
   * once for the app, so calling this per sidebar row costs one store
   * subscription and a pure `item` call per registration. Pass `keys` for a
   * row's quick actions. Experimental: see docs/api_to_audit.md.
   */
  experimental_useThreadActions(
    thread: PluginThreadActionTarget,
    options?: PluginThreadActionsOptions,
  ): readonly PluginThreadActionEntry[];
  /**
   * Every registered `"menu"` thread action with its static title and icon,
   * in menu order and independent of any thread: what a quick-action picker
   * lists.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useThreadActionRegistrations(): readonly PluginThreadActionRegistrationInfo[];
  /**
   * bb's thread menu behind a trigger (see
   * {@link PluginThreadActionsMenuProps}): the same items, order, choice
   * submenus and compact drawer as the thread header's menu. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_ThreadActionsMenu: ComponentType<PluginThreadActionsMenuProps>;
  /**
   * bb's thread menu on right-click or long-press (see
   * {@link PluginThreadActionsContextMenuProps}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_ThreadActionsContextMenu: ComponentType<PluginThreadActionsContextMenuProps>;
  /**
   * bb's thread menu groups, for a registration that joins one:
   * `open` (split, copy link, new thread in environment), `state` (pin,
   * read, notifications), `organize` (rename, move), `settings`, and
   * `lifecycle` (archive, delete). Experimental: see docs/api_to_audit.md.
   */
  experimental_THREAD_ACTION_GROUPS: {
    readonly open: "1_open";
    readonly state: "1_state";
    readonly organize: "2_organize";
    readonly settings: "3_settings";
    readonly lifecycle: "4_lifecycle";
  };
  /**
   * bb's thread context segment groups, for an
   * `experimental_threadContextSegment` that joins one: `thread` (Parent
   * thread) and `git` (Changed files). A plugin names its own
   * group to sort between them, such as `"2_pullRequest"`. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS: {
    readonly thread: "1_thread";
    readonly git: "3_git";
  };
  /**
   * bb's thread Info row groups, for an `experimental_threadInfoRow` that
   * joins one: `thread` (Parent, Notify parent, Project), `environment`
   * (Environment, Machine, provisioning failure, Directory), `git` (Branch,
   * Merge base, Git status), `pullRequest`, and `lifecycle` (Archived).
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_THREAD_INFO_ROW_GROUPS: {
    readonly thread: "1_thread";
    readonly environment: "2_environment";
    readonly git: "3_git";
    readonly pullRequest: "4_pullRequest";
    readonly lifecycle: "5_lifecycle";
  };
  /**
   * bb's thread Info section groups, for an `experimental_threadInfoSection`
   * that joins one: `related` (Child threads, Forks), `changes` (Commits,
   * Uncommitted files), and `storage` (Thread storage). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_THREAD_INFO_SECTION_GROUPS: {
    readonly related: "1_related";
    readonly changes: "2_changes";
    readonly storage: "3_storage";
  };
  /**
   * Per-row drag-to-split support (see {@link PluginSidebarThreadSplit}).
   * Call it once per rendered row, like the built-in sidebar does.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useSidebarThreadSplit(
    threadId: string,
    options?: PluginSidebarThreadSplitOptions,
  ): PluginSidebarThreadSplit;
  /**
   * The sidebar navigation items in the user's saved order, the active item,
   * and the host actions that activate, hide, reorder, and customize them
   * (see {@link ExperimentalSidebarNavigationState}). One model shared by
   * every navigation provider, bb's included. Items keep their identity while
   * unchanged. Outside the sidebar it returns no items and actions that do
   * nothing. Experimental: see docs/api_to_audit.md.
   */
  experimental_useSidebarNavigation(): ExperimentalSidebarNavigationState;
  /**
   * Per-item drag-to-split support for navigation items (see
   * {@link ExperimentalSidebarNavigationSplit}). Call it once per rendered
   * item. Experimental: see docs/api_to_audit.md.
   */
  experimental_useSidebarNavigationSplit(
    itemId: string,
    options?: ExperimentalSidebarNavigationSplitOptions,
  ): ExperimentalSidebarNavigationSplit;
  /**
   * bb's artwork for a navigation item's icon: bb's glyphs for its own items,
   * and the panel's explicit icon, falling back to plugin branding, for
   * plugin panels. Experimental: see docs/api_to_audit.md.
   */
  experimental_SidebarNavigationIcon: ComponentType<ExperimentalSidebarNavigationIconProps>;
  /**
   * Whether the composer holds an unsent draft for one thread (see
   * {@link PluginSidebarThreadDraftState}). Per row, because a draft is
   * client-local composer state the array-wide view cannot carry. Reports
   * false for an unknown thread.
   */
  useSidebarThreadDraft(threadId: string): PluginSidebarThreadDraftState;
  /**
   * The ids of every sidebar thread that currently holds an unsent draft, for
   * rollups on collapsed groups. One subscription for the whole list; prefer
   * {@link PluginSdkApp.useSidebarThreadDraft} inside a row.
   */
  useSidebarThreadDraftIds(): ReadonlySet<string>;
  /**
   * The row status another plugin set on this thread (see
   * {@link PluginSidebarThreadRowStatus}), or null. Draw it where bb's row
   * would: in place of the draft glyph, with its `tone`.
   */
  useSidebarThreadRowStatus(
    threadId: string,
  ): PluginSidebarThreadRowStatus | null;
  /**
   * Every row status currently set, by thread id, for rollups on collapsed
   * groups. One subscription for the whole list; prefer
   * {@link PluginSdkApp.useSidebarThreadRowStatus} inside a row.
   */
  useSidebarThreadRowStatuses(): ReadonlyMap<
    string,
    PluginSidebarThreadRowStatus
  >;
  /**
   * The whole split layout (see {@link PluginSidebarSplitLayout}), or null
   * when nothing is split. One subscription for the whole list.
   */
  useSidebarSplitLayout(): PluginSidebarSplitLayout | null;
  /**
   * The jump shortcut assigned to this row while the app command modifier is
   * held (see {@link PluginSidebarThreadShortcut}), or null the rest of the
   * time. bb assigns keys in DOM order to rows carrying the
   * `data-sidebar-thread-shortcut-target` attribute, so a row that omits it
   * always reads null.
   */
  useSidebarThreadShortcut(
    threadId: string,
  ): PluginSidebarThreadShortcut | null;
  /**
   * A thread's display title with `@project:`, `@section:`, and `@thread:`
   * mentions rendered as bb's chips (see {@link PluginThreadTitleProps}).
   * Inline content; wrap it in your own truncating container. The plain-text
   * form is `displayTitle` on the thread.
   */
  ThreadTitle: ComponentType<PluginThreadTitleProps>;
  /**
   * bb's thread status glyph (see {@link PluginThreadStatusGlyphProps}): the
   * same icons, colors, and accessible labels as bb's own thread lists.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_ThreadStatusGlyph: ComponentType<PluginThreadStatusGlyphProps>;
  /**
   * Every `experimental_threadRowMetadata` contribution for one thread row (see
   * {@link ExperimentalThreadRowMetadataRegistration}), the items bb's sidebar
   * draws on its rows' metadata line. Render it under your row's title, in
   * a flex parent as wide as the line. Badges such as a pull request's status then appear on your rows as they do on
   * bb's. It renders nothing when no plugin contributes an item.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_ThreadRowMetadata: ComponentType<ExperimentalThreadRowMetadataLineProps>;
  /**
   * bb's environment provider catalog (see
   * {@link PluginEnvironmentProvidersState}), the directory a thread's
   * `environment.providerId` points into. Reads the host's own cached
   * catalog, so it costs no extra request.
   */
  useEnvironmentProviders(): PluginEnvironmentProvidersState;
  /**
   * bb's public API client bound to this plugin (see
   * {@link PluginBrowserBbSdk}). The first choice for reading and mutating
   * bb state from a frontend: creating or renaming thread sections, moving a
   * thread into one, pinning, unarchiving, spawning a thread. The host's own
   * caches refresh over realtime, so a mutation made here shows up in bb's
   * surfaces without further work. Reserve `useRpc` for work that needs your
   * server: secrets, host files, or your plugin's own storage.
   *
   * Thread title, section, parent, pin, and unpin writes are optimistic in
   * bb's surfaces. Synchronous calls share one cache transaction; writes to
   * the same thread execute in order, so unpin and move can be submitted
   * together. Unarchive, environment-group archive, project/machine/environment
   * renames, and project/section removal are also optimistic and roll back on
   * failure. Created sections enter the cache when the server assigns their id.
   * Navigation belongs to `useBbNavigate()`; archive and delete
   * confirmation to the thread action menus.
   *
   * The client is stable for the plugin's lifetime, so it is safe in effect
   * and callback dependency lists.
   */
  useSdk(): PluginBrowserBbSdk;
  /**
   * The provider directory (see {@link PluginProvidersState}). Reads the
   * host's own cached provider roster, so a plugin that shows a thread's
   * provider never re-vendors provider names, icons, or copy. Experimental:
   * see docs/api_to_audit.md.
   */
  experimental_useProviders(): PluginProvidersState;
  /**
   * The active code theme as a VS Code theme file (see
   * {@link PluginCodeThemeState}), for a plugin that renders code with an
   * engine of its own and needs BB's palette to reach it. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_useCodeTheme(): PluginCodeThemeState;
  /**
   * Writes content to the system clipboard through bb's own clipboard writer,
   * the one bb's copy actions use. A plain function, callable from
   * components, content scripts, and command callbacks. bb Desktop writes
   * through the native clipboard, so copies work without window focus or a
   * secure origin; browsers use the Clipboard API, then the copy command.
   * Resolves true once the clipboard holds the content and false when every
   * write path failed; it never rejects. Callers own their success and
   * failure feedback. Experimental: see docs/api_to_audit.md.
   */
  experimental_copyToClipboard(
    content: ExperimentalClipboardContent,
  ): Promise<boolean>;
  /**
   * Saves a file through bb's own download path, the one bb's file preview
   * and attachment downloads use. Browsers and bb Desktop start an ordinary
   * download. In the bb iOS app, where a download link would otherwise
   * replace the app, the file goes to the system share sheet (Save to Files,
   * AirDrop, other apps). A plain function: call it from a click handler and
   * keep a real `href` on the link for copy-link and accessibility. Resolves
   * with `started` or `failed` and never rejects. Completion and share-sheet
   * cancellation are not reported. The native shell shows download errors;
   * bb shows an error toast when the download cannot start.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_saveFile(
    request: ExperimentalSaveFileRequest,
  ): Promise<ExperimentalSaveFileOutcome>;
  /**
   * The host-owned chat component (see {@link ThreadChatProps}). Together
   * with `Markdown`, the only components the SDK ships — everything else
   * stays vendored per §5.5.
   */
  ThreadChat: ComponentType<ThreadChatProps>;
  /**
   * The host-owned chat-message markdown renderer (see
   * {@link MarkdownProps}).
   */
  Markdown: ComponentType<MarkdownProps>;
  /**
   * A real anchor whose ordinary HTTP(S) activation uses BB's URL preference.
   * Experimental: see docs/api_to_audit.md.
   */
  UrlLink: ComponentType<UrlLinkProps>;
  /** Host-rendered live-file link backed by the shared navigation controller. */
  experimental_FileLink: ComponentType<ExperimentalFileLinkProps>;
  /**
   * The host-owned new-thread compose surface (see
   * {@link NewThreadComposerProps}). Experimental: see
   * docs/api_to_audit.md for what to audit before the prefix drops.
   */
  experimental_NewThreadComposer: ComponentType<NewThreadComposerProps>;
  /**
   * BB's textarea with voice input (see
   * {@link ExperimentalVoiceInputTextareaProps}): the same microphone
   * preference, transcription service, and error handling as the prompt box.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_VoiceInputTextarea: ComponentType<ExperimentalVoiceInputTextareaProps>;
  /**
   * BB's controlled provider/model/reasoning picker. Provider changes emit
   * only after the new provider's verified defaults and capabilities resolve,
   * so `onChange` always receives one coherent value. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_ProviderModelPicker: ComponentType<ExperimentalProviderModelPickerProps>;
  /**
   * BB's controlled permission-mode picker. The host resolves provider
   * capabilities and the routed machine's permission ceiling. Experimental:
   * see docs/api_to_audit.md.
   */
  experimental_PermissionModePicker: ComponentType<ExperimentalPermissionModePickerProps>;
  /**
   * BB's branch picker with its branch-options loading for one host and
   * project (see {@link BranchPickerProps}) — the same control
   * the New Thread composer renders as "Branch from". Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_BranchPicker: ComponentType<BranchPickerProps>;
  /**
   * Search and refresh the branch list for one project source. `query` is
   * debounced before it reaches the host, so a control can pass it on every
   * keystroke; filtering the returned lists stays the caller's job.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useBranches(args: UseBranchesArgs): BranchesState;
  /**
   * Inspect the checkout state for one project source. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_useCheckoutState(args: UseCheckoutStateArgs): CheckoutState;
  /**
   * The host-owned source viewer (see {@link SourceCodeProps}). Renders
   * supplied source text with BB's syntax highlighting, gutters, and live code
   * theme, and honours an active `experimental_sourceCodeRenderer`
   * replacement. Experimental: see docs/api_to_audit.md.
   */
  experimental_SourceCode: ComponentType<SourceCodeProps>;
  /**
   * The host-owned diff viewer (see {@link DiffProps}). Renders supplied patch
   * content with BB's normalization, optional full-file context expansion,
   * syntax highlighting, unified/split presentation, and live code theme, and
   * honours an active
   * `experimental_diffRenderer` replacement. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_Diff: ComponentType<DiffProps>;
  /**
   * The thread Info tab's section frame (see
   * {@link ExperimentalInfoSectionProps}), the one bb's own sections use.
   * Inside an `experimental_threadInfoSection` it collapses, and the host
   * remembers that per registration. Experimental: see docs/api_to_audit.md.
   */
  experimental_InfoSection: ComponentType<ExperimentalInfoSectionProps>;
  /**
   * The thread Info tab's label and value row (see
   * {@link ExperimentalDetailRowProps}), the one bb's own rows use.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_DetailRow: ComponentType<ExperimentalDetailRowProps>;
  /**
   * The thread Info tab's list (see {@link ExperimentalInfoListProps}), the
   * one bb's own sections use. Experimental: see docs/api_to_audit.md.
   */
  experimental_InfoList<Item>(
    props: ExperimentalInfoListProps<Item>,
  ): ReactNode;
  /**
   * One row of `experimental_InfoList` (see
   * {@link ExperimentalInfoListRowProps}), the row bb's own sections use.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_InfoListRow: ComponentType<ExperimentalInfoListRowProps>;
  /**
   * Host-owned inputs and actions for an `experimental_composer` replacement
   * (see {@link ExperimentalComposerRendererApi}). Throws outside an
   * `experimental_composer` component. Experimental: see docs/api_to_audit.md.
   */
  experimental_useComposerRenderer(): ExperimentalComposerRendererApi;
  /**
   * A raw thread title with its @-mentions replaced by the threads' current
   * titles. Experimental: see docs/api_to_audit.md.
   */
  experimental_useThreadTitleDisplayText(title: string): string;
  /**
   * Other plugins' popups, `+` and send menu items and inline actions for
   * this composer, with their host renderers. Throws outside an
   * `experimental_composer` component. Experimental: see docs/api_to_audit.md.
   */
  experimental_useComposerContributions(): ExperimentalComposerContributions;
  /**
   * Search bb's @-mention sources for this composer: files, threads,
   * projects, sections and plugin mention providers. Report the open menu's
   * query with `search()`; the results are for the last query reported, and a
   * composer has one mention search. Throws outside an
   * `experimental_composer` component. Experimental: see docs/api_to_audit.md.
   */
  experimental_useComposerMentionSearch(): ExperimentalComposerMentionSearch;
  /**
   * Search the slash commands and skills for this composer's provider.
   * Report the open menu's query with `search()`; the results are for the
   * last query reported, and a composer has one command search. Throws
   * outside an `experimental_composer` component. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_useComposerCommandSearch(): ExperimentalComposerCommandSearch;
  /**
   * Connect a composer to bb: render it inside the composer's root element.
   * It publishes `editor` to other plugins' `useComposer()`, routes bb's and
   * other plugins' composer commands to keys inside `rootRef`, and makes the
   * root the target of pane focus and thread drops. Renders no DOM.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_ComposerRoot: ComponentType<ExperimentalComposerRootProps>;
  /** Composer host components; see docs/api_to_audit.md. */
  experimental_VoiceInputButton: ComponentType<ExperimentalVoiceInputButtonProps>;
  experimental_VoiceRecordingBar: ComponentType<ExperimentalVoiceRecordingBarProps>;
  experimental_FailedVoiceRecordings: ComponentType<ExperimentalFailedVoiceRecordingsProps>;
  experimental_ShortcutHint: ComponentType<ExperimentalShortcutHintProps>;
  experimental_ImageLightbox: ComponentType<ExperimentalImageLightboxProps>;
  experimental_PromptMentionIcon: ComponentType<ExperimentalPromptMentionIconProps>;
  /**
   * The classes, tooltip and text bb gives a pill for `mention`, so pills look
   * the same in a composer and in bb's messages. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_describePromptMention(
    mention: ExperimentalComposerMentionTarget,
  ): ExperimentalPromptMentionPresentation;
  /**
   * Attributes to spread onto a pill element so that copying it and pasting
   * into any bb composer recreates the pill; `text` is the draft text the pill
   * covers. Experimental: see docs/api_to_audit.md.
   */
  experimental_promptMentionClipboardAttributes(
    mention: ExperimentalComposerMentionTarget,
    text: string,
  ): Readonly<Record<string, string>>;
  /**
   * The pill a pasted element stands for, when it was copied from a bb
   * composer or message; null for any other element. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_readPromptMentionClipboard(
    element: Element,
  ): ExperimentalPromptMentionClipboardPill | null;
  experimental_PluginIcon: ComponentType<ExperimentalPluginIconProps>;
  experimental_ThreadTitleText: ComponentType<ExperimentalThreadTitleTextProps>;
  /** @internal Superseded by `useComposer()`; kept for plugins built against older SDKs. */
  useComposerView(): ComposerView;
}
