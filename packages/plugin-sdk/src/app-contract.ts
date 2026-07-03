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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PluginNavPanelProps {}

/** Props passed to a `threadPanelTab` component. */
export interface PluginThreadPanelTabProps {
  threadId: string;
}

/** Props passed to a `composerAccessory` component. */
export interface PluginComposerAccessoryProps {
  projectId: string | null;
  threadId: string | null;
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

export interface PluginThreadPanelTabRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  component: ComponentType<PluginThreadPanelTabProps>;
  /**
   * Optional synchronous visibility predicate, evaluated per thread on
   * render. V1 is sync-only (the design allows async later); keep it cheap
   * and side-effect free. A throwing predicate hides the tab.
   */
  visible?: (context: { threadId: string }) => boolean;
}

export interface PluginComposerAccessoryRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  component: ComponentType<PluginComposerAccessoryProps>;
}

// ---------------------------------------------------------------------------
// definePluginApp
// ---------------------------------------------------------------------------

export interface PluginAppSlots {
  homepageSection(registration: PluginHomepageSectionRegistration): void;
  navPanel(registration: PluginNavPanelRegistration): void;
  threadPanelTab(registration: PluginThreadPanelTabRegistration): void;
  composerAccessory(registration: PluginComposerAccessoryRegistration): void;
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

/** Current app selection, derived from the route. */
export interface BbContext {
  projectId: string | null;
  threadId: string | null;
}

export interface BbNavigate {
  toThread(threadId: string): void;
  toProject(projectId: string): void;
  /** Navigate to one of this plugin's own nav panels by its `path`. */
  toPluginPanel(path: string): void;
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
