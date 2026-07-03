import * as react from "react";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
// Shared-singleton packages (plugin design §5.5): the portaling radix
// families + sonner + vaul. Vendored plugin components import these
// specifiers; `bb plugin build` shims them to the slots installed below, so
// plugin overlays live in the host's dismissable-layer/focus/scroll-lock
// world and plugin toast() reaches the host toaster. Importing them here
// (menubar/hover-card/etc. included) is what puts them in the host bundle.
import * as radixAlertDialog from "@radix-ui/react-alert-dialog";
import * as radixContextMenu from "@radix-ui/react-context-menu";
import * as radixDialog from "@radix-ui/react-dialog";
import * as radixDropdownMenu from "@radix-ui/react-dropdown-menu";
import * as radixHoverCard from "@radix-ui/react-hover-card";
import * as radixMenubar from "@radix-ui/react-menubar";
import * as radixNavigationMenu from "@radix-ui/react-navigation-menu";
import * as radixPopover from "@radix-ui/react-popover";
import * as radixSelect from "@radix-ui/react-select";
import * as radixTooltip from "@radix-ui/react-tooltip";
import * as sonner from "sonner";
import * as vaul from "vaul";
import * as pierreDiffs from "@pierre/diffs";
import * as pierreDiffsReact from "@pierre/diffs/react";
import { createDebouncedCallbackScheduler } from "@bb/domain";
import type { PluginSdkApp } from "@bb/plugin-sdk";
import { resetCrashedPluginSlots } from "@/components/plugin/PluginSlotMount";
import { interpretPluginFrontends } from "./plugin-app-definition";
import { setPluginLogoUrls, type PluginLogoUrls } from "./plugin-logos";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "./plugin-slots";

/**
 * Plugin frontend bundle loading (plugin design §5.1). Once per page load,
 * after system config resolves the `plugins` experiment: expose the shared
 * runtime on `globalThis.__bbPluginRuntime`, fetch the plugin inventory, and
 * for each enabled+running plugin with a compatible bundle link its CSS and
 * dynamic-import() its JS. Per-plugin containment: a bundle that fails to
 * import records status "failed" and never breaks the app or other plugins;
 * an SDK-major-mismatched bundle records "needs-update" and is skipped.
 *
 * The registry keeps each loaded module's namespace keyed by plugin id;
 * after loading, each module's default export (a `definePluginApp` product)
 * is interpreted into the slot store (plugin-app-definition.ts).
 *
 * Live reload (P3.4): the realtime `plugins-changed` broadcast schedules
 * {@link schedulePluginFrontendReconcile}, which re-fetches the inventory
 * and re-imports only plugins whose bundle hash changed (fresh-hash URL, so
 * the browser module cache never serves a stale bundle), replacing their
 * slot registrations wholesale. Old ESM module objects cannot be unloaded —
 * they just become unreferenced; that is the accepted design.
 */

/** Mirror of the `app.bundle` slice of a GET /api/v1/plugins entry. */
export interface PluginFrontendBundle {
  jsUrl: string;
  cssUrl: string | null;
  hash: string;
  sdkMajor: number;
  sdkVersion: string;
  compatible: boolean;
}

export interface PluginFrontendCandidate {
  pluginId: string;
  bundle: PluginFrontendBundle;
}

export type PluginFrontendRecord =
  | {
      pluginId: string;
      status: "loaded";
      /** The bundle's ESM namespace (default export = the plugin app). */
      module: Record<string, unknown>;
    }
  | { pluginId: string; status: "failed"; error: string }
  | {
      pluginId: string;
      status: "needs-update";
      sdkMajor: number;
      sdkVersion: string;
    };

export interface PluginFrontendLoaderDeps {
  importModule: (url: string) => Promise<unknown>;
  injectCss: (pluginId: string, url: string) => void;
  warn: (message: string) => void;
}

/**
 * Load every candidate bundle, one record per plugin. Never throws: each
 * plugin's import/evaluation failure is contained in its own record.
 */
export async function loadPluginFrontends(
  candidates: readonly PluginFrontendCandidate[],
  deps: PluginFrontendLoaderDeps,
): Promise<Map<string, PluginFrontendRecord>> {
  const records = new Map<string, PluginFrontendRecord>();
  await Promise.all(
    candidates.map(async (candidate) => {
      records.set(candidate.pluginId, await loadOneBundle(candidate, deps));
    }),
  );
  return records;
}

async function loadOneBundle(
  { pluginId, bundle }: PluginFrontendCandidate,
  deps: PluginFrontendLoaderDeps,
): Promise<PluginFrontendRecord> {
  if (!bundle.compatible) {
    deps.warn(
      `[plugin:${pluginId}] frontend bundle was built against plugin SDK ${bundle.sdkVersion} (incompatible major) — skipping until the plugin is updated`,
    );
    return {
      pluginId,
      status: "needs-update",
      sdkMajor: bundle.sdkMajor,
      sdkVersion: bundle.sdkVersion,
    };
  }
  try {
    if (bundle.cssUrl !== null) deps.injectCss(pluginId, bundle.cssUrl);
    const mod = await deps.importModule(bundle.jsUrl);
    if (typeof mod !== "object" || mod === null) {
      throw new Error("bundle did not evaluate to a module namespace");
    }
    return {
      pluginId,
      status: "loaded",
      module: mod as Record<string, unknown>,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.warn(
      `[plugin:${pluginId}] frontend bundle failed to load: ${message}`,
    );
    return { pluginId, status: "failed", error: message };
  }
}

// ---------------------------------------------------------------------------
// Shared runtime + boot wiring (real browser paths).
// ---------------------------------------------------------------------------

interface BbPluginRuntime {
  react: unknown;
  reactDom: unknown;
  reactDomClient: unknown;
  jsxRuntime: unknown;
  jsxDevRuntime: unknown;
  pluginSdkApp: PluginSdkApp;
  radixAlertDialog: unknown;
  radixContextMenu: unknown;
  radixDialog: unknown;
  radixDropdownMenu: unknown;
  radixHoverCard: unknown;
  radixMenubar: unknown;
  radixNavigationMenu: unknown;
  radixPopover: unknown;
  radixSelect: unknown;
  radixTooltip: unknown;
  sonner: unknown;
  vaul: unknown;
  pierreDiffs: unknown;
  pierreDiffsReact: unknown;
}

type RuntimeHost = typeof globalThis & { __bbPluginRuntime?: BbPluginRuntime };

/**
 * Expose the app's own React graph (plus the SDK slot) on
 * `globalThis.__bbPluginRuntime` — set exactly once, and always before any
 * bundle import()s (their shims read it at evaluation time). One React in
 * the page, ever; a second copy is the "Invalid hook call" factory.
 */
export function installPluginRuntime(): void {
  const host = globalThis as RuntimeHost;
  if (host.__bbPluginRuntime !== undefined) return;
  host.__bbPluginRuntime = {
    react,
    reactDom,
    reactDomClient,
    jsxRuntime,
    jsxDevRuntime,
    // The real `@bb/plugin-sdk/app` surface: definePluginApp, the hooks, and
    // the curated UI kit. Kept in type-sync with the facade package via
    // `satisfies PluginSdkApp` in plugin-sdk-app-impl.
    pluginSdkApp: pluginSdkAppImplementation,
    radixAlertDialog,
    radixContextMenu,
    radixDialog,
    radixDropdownMenu,
    radixHoverCard,
    radixMenubar,
    radixNavigationMenu,
    radixPopover,
    radixSelect,
    radixTooltip,
    sonner,
    vaul,
    pierreDiffs,
    pierreDiffsReact,
  };
}

function isFrontendBundle(value: unknown): value is PluginFrontendBundle {
  if (typeof value !== "object" || value === null) return false;
  const bundle = value as Record<string, unknown>;
  return (
    typeof bundle.jsUrl === "string" &&
    (bundle.cssUrl === null || typeof bundle.cssUrl === "string") &&
    typeof bundle.hash === "string" &&
    typeof bundle.sdkMajor === "number" &&
    typeof bundle.sdkVersion === "string" &&
    typeof bundle.compatible === "boolean"
  );
}

/** Enabled + running plugins with a servable bundle, from GET /api/v1/plugins. */
async function fetchFrontendCandidates(): Promise<PluginFrontendCandidate[]> {
  const response = await fetch("/api/v1/plugins");
  // Nothing to load rather than an error: an older server or a disabled
  // experiment both mean "no plugin frontends".
  if (!response.ok) return [];
  const body = (await response.json()) as { plugins?: unknown };
  if (!Array.isArray(body.plugins)) return [];
  const candidates: PluginFrontendCandidate[] = [];
  // Same fetch feeds the logo store: every surface rendering a plugin
  // contribution (sidebar, menus, thread actions) resolves logos from it.
  const logoUrls = new Map<string, PluginLogoUrls>();
  for (const entry of body.plugins) {
    const typed = entry as {
      id?: unknown;
      enabled?: unknown;
      status?: unknown;
      logoUrl?: unknown;
      logoDarkUrl?: unknown;
      app?: { bundle?: unknown };
    } | null;
    if (typeof typed?.id !== "string") continue;
    const logoUrl = typeof typed.logoUrl === "string" ? typed.logoUrl : null;
    const logoDarkUrl =
      typeof typed.logoDarkUrl === "string" ? typed.logoDarkUrl : null;
    if (logoUrl !== null || logoDarkUrl !== null) {
      logoUrls.set(typed.id, { logoUrl, logoDarkUrl });
    }
    if (typed.enabled !== true || typed.status !== "running") {
      continue;
    }
    const bundle = typed.app?.bundle;
    if (!isFrontendBundle(bundle)) continue;
    candidates.push({ pluginId: typed.id, bundle });
  }
  setPluginLogoUrls(logoUrls);
  return candidates;
}

/**
 * Point a plugin's stylesheet `<link data-bb-plugin-css="<id>">` at `url`,
 * or remove it (`url: null`). A changed URL swaps in a fresh element (the
 * new sheet loads, then the old element is removed) rather than mutating
 * `href`, so a reload never flashes unstyled plugin UI. If the fresh sheet
 * fails to load, it is dropped and the old sheet stays in place.
 */
export function applyPluginCss(pluginId: string, url: string | null): void {
  const marker = "data-bb-plugin-css";
  const existing = [
    ...document.head.querySelectorAll(`link[${marker}="${pluginId}"]`),
  ];
  if (url === null) {
    for (const link of existing) link.remove();
    return;
  }
  if (existing.some((link) => link.getAttribute("href") === url)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.setAttribute(marker, pluginId);
  link.onload = () => {
    for (const old of existing) old.remove();
  };
  link.onerror = () => {
    link.remove();
    console.warn(`bb plugin "${pluginId}": failed to load stylesheet ${url}`);
  };
  document.head.appendChild(link);
}

// ---------------------------------------------------------------------------
// Reconcile: boot + live reload share one injectable state transition.
// ---------------------------------------------------------------------------

export interface PluginFrontendReconcileState {
  records: Map<string, PluginFrontendRecord>;
  /** Bundle hash last applied per plugin; an unchanged hash is a no-op. */
  appliedHashes: Map<string, string>;
}

export function createPluginFrontendReconcileState(): PluginFrontendReconcileState {
  return { records: new Map(), appliedHashes: new Map() };
}

export interface PluginFrontendReconcileDeps {
  fetchCandidates: () => Promise<PluginFrontendCandidate[]>;
  importModule: (url: string) => Promise<unknown>;
  /** Replace (string) or remove (null) the plugin's CSS `<link>`. */
  applyCss: (pluginId: string, url: string | null) => void;
  resetCrashedSlots: (pluginId: string) => void;
  setRegistrations: (
    pluginId: string,
    registrations: PluginRegistrationSet,
  ) => void;
  removeRegistrations: (pluginId: string) => void;
  warn: (message: string) => void;
}

/**
 * Bring the frontend plugin state in line with the server inventory:
 *
 * - plugin gone/disabled/stopped → drop its slot registrations + CSS link;
 * - bundle hash changed (or plugin newly present) → reset crashed-slot
 *   latches, re-import via the fresh-hash URL, replace the CSS link, and
 *   REPLACE its slot registrations wholesale (the generation bump remounts
 *   mounted slots) — never appended, so reloading twice still yields exactly
 *   one of each registration;
 * - unchanged hash → untouched (a backend-only reload never remounts UI).
 *
 * A re-import/interpretation failure downgrades that plugin to "failed" and
 * removes its previous UI (stale components would call a disposed backend).
 */
export async function reconcilePluginFrontends(
  state: PluginFrontendReconcileState,
  deps: PluginFrontendReconcileDeps,
): Promise<void> {
  const candidates = await deps.fetchCandidates();
  const candidateIds = new Set(candidates.map((c) => c.pluginId));
  for (const pluginId of [...state.records.keys()]) {
    if (candidateIds.has(pluginId)) continue;
    deps.removeRegistrations(pluginId);
    deps.applyCss(pluginId, null);
    state.records.delete(pluginId);
    state.appliedHashes.delete(pluginId);
  }
  for (const candidate of candidates) {
    const previous = state.records.get(candidate.pluginId);
    if (
      previous !== undefined &&
      previous.status !== "failed" && // failed bundles retry (e.g. transient fetch error)
      state.appliedHashes.get(candidate.pluginId) === candidate.bundle.hash
    ) {
      continue;
    }
    // A fixed plugin gets a fresh chance: clear crashed-slot latches before
    // the replaced registrations remount their boundaries.
    deps.resetCrashedSlots(candidate.pluginId);
    const loaded = await loadPluginFrontends([candidate], {
      importModule: deps.importModule,
      injectCss: deps.applyCss,
      warn: deps.warn,
    });
    interpretPluginFrontends(loaded, {
      setRegistrations: deps.setRegistrations,
      warn: deps.warn,
    });
    const record = loaded.get(candidate.pluginId);
    if (record === undefined) continue;
    state.records.set(candidate.pluginId, record);
    state.appliedHashes.set(candidate.pluginId, candidate.bundle.hash);
    if (record.status === "loaded") {
      // The new bundle ships no CSS: drop a previous version's link.
      if (candidate.bundle.cssUrl === null) {
        deps.applyCss(candidate.pluginId, null);
      }
    } else {
      // failed / needs-update replacing a previously working frontend.
      deps.removeRegistrations(candidate.pluginId);
      deps.applyCss(candidate.pluginId, null);
    }
  }
}

/**
 * Debounce + serialize reconcile runs: a burst of `plugins-changed`
 * broadcasts (e.g. `bb plugin reload` with several plugins) coalesces into
 * one run, and a broadcast landing mid-run queues exactly one follow-up
 * instead of overlapping it.
 */
export function createPluginFrontendReconcileScheduler(args: {
  run: () => Promise<void>;
  debounceMs?: number;
}): { schedule: () => void } {
  const debounceMs = args.debounceMs ?? 250;
  let inFlight = false;
  let queued = false;
  const execute = async (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      await args.run();
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        void execute();
      }
    }
  };
  const scheduler = createDebouncedCallbackScheduler({
    debounceMs,
    maxWaitMs: debounceMs * 4,
    onFlush: () => void execute(),
  });
  return { schedule: () => scheduler.schedule() };
}

const state = createPluginFrontendReconcileState();
let bootPromise: Promise<void> | null = null;

const browserReconcileDeps: PluginFrontendReconcileDeps = {
  fetchCandidates: fetchFrontendCandidates,
  importModule: (url) => import(/* @vite-ignore */ url),
  applyCss: applyPluginCss,
  resetCrashedSlots: resetCrashedPluginSlots,
  setRegistrations: setPluginSlotRegistrations,
  removeRegistrations: removePluginSlotRegistrations,
  warn: (message) => console.warn(message),
};

/** Load state of every plugin frontend this page load, keyed by plugin id. */
export function getPluginFrontendRecords(): ReadonlyMap<
  string,
  PluginFrontendRecord
> {
  return state.records;
}

/**
 * Idempotent per page load. Called after system config confirms the
 * `plugins` experiment; runs entirely off the first-paint path.
 */
export function bootPluginFrontends(): Promise<void> {
  bootPromise ??= (async () => {
    installPluginRuntime();
    await reconcilePluginFrontends(state, browserReconcileDeps);
  })().catch((error: unknown) => {
    // Inventory fetch/network failure — plugin UI is absent, app unharmed.
    console.warn(
      `plugin frontend boot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  return bootPromise;
}

async function runLiveReconcile(): Promise<void> {
  try {
    // Boot's own reconcile settles first (bootPromise never rejects).
    await bootPromise;
    await reconcilePluginFrontends(state, browserReconcileDeps);
  } catch (error) {
    console.warn(
      `plugin frontend reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

let liveScheduler: { schedule: () => void } | null = null;

/**
 * Realtime `plugins-changed` hook (wired in realtime-cache-registry): live
 * frontend reload without a page refresh. A no-op until the frontends have
 * booted (experiment off / boot pending — boot loads current state anyway).
 */
export function schedulePluginFrontendReconcile(): void {
  if (bootPromise === null) return;
  liveScheduler ??= createPluginFrontendReconcileScheduler({
    run: runLiveReconcile,
  });
  liveScheduler.schedule();
}
