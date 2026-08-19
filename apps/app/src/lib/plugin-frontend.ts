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
// Host-resident libraries (RUNTIME_SLOT_BY_SPECIFIER rule 2): no singleton
// semantics, but every plugin app used to bundle its own copy — the
// shared-ui Icon alone carries the hugeicons map. The host already ships
// all of them, so plugins read them from here. Anything slotted here is
// exposed as a whole namespace, which keeps rolldown from tree-shaking it
// out of the boot chunk: that is why zod (mostly unused by the app) is
// deliberately not a slot.
import * as clsx from "clsx";
import * as tailwindMerge from "tailwind-merge";
import * as classVarianceAuthority from "class-variance-authority";
import * as sharedUiIcon from "@bb/shared-ui/icon";
import { createDebouncedCallbackScheduler } from "@bb/domain";
import type {
  PluginContentScriptDisposer,
  PluginContentScriptRegistration,
  PluginSdkApp,
} from "@get-bb/plugin-sdk";
import { normalizePluginThreadRowStatus } from "@get-bb/plugin-sdk/internal/composer-customization-validation";
import { resetCrashedPluginSlots } from "@/components/plugin/PluginSlotMount";
import { runWithPluginDomIsolationAsync } from "./foreign-dom-mutation-guard";
import {
  collectPluginAppRegistrations,
  isPluginAppDefinition,
} from "./plugin-app-definition";
import { setPluginLogoUrls, type PluginLogoUrls } from "./plugin-logos";
import { createGatedPierreDiffsReact } from "./plugin-pierre-diffs-react";
import { getPluginPanelRoutePluginId } from "./route-paths";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import {
  beginPluginSlotBatch,
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "./plugin-slots";
import {
  clearPluginThreadRowStatuses,
  clearPluginThreadRowStatusesByOwner,
  setPluginThreadRowStatus,
} from "./plugin-thread-row-status";

/**
 * Plugin frontend bundle loading (plugin design §5.1). Once per page load,
 * after system config resolves: expose the shared
 * runtime on `globalThis.__bbPluginRuntime`, fetch the plugin inventory, and
 * for each running plugin with a compatible bundle link its CSS and
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
  /** dist/app.js size; smaller bundles load first (see reconcile). */
  jsBytes: number;
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

export interface PluginFrontendFailure {
  phase: "load" | "setup" | "mount" | "dispose";
  message: string;
  scriptId: string | null;
}

export interface PluginFrontendActiveGenerationDiagnostic {
  generation: number;
  hash: string;
  contentScriptIds: readonly string[];
}

/** Per-window frontend lifecycle state shown in plugin diagnostics. */
export type PluginFrontendDiagnostic =
  | {
      pluginId: string;
      status: "active";
      active: PluginFrontendActiveGenerationDiagnostic;
      lastFailure: PluginFrontendFailure | null;
    }
  | {
      pluginId: string;
      status: "failed";
      active: PluginFrontendActiveGenerationDiagnostic | null;
      lastFailure: PluginFrontendFailure;
    }
  | {
      pluginId: string;
      status: "needs-update";
      active: PluginFrontendActiveGenerationDiagnostic | null;
      sdkMajor: number;
      sdkVersion: string;
      lastFailure: null;
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
  clsx: unknown;
  tailwindMerge: unknown;
  classVarianceAuthority: unknown;
  sharedUiIcon: unknown;
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
    // The real `@get-bb/plugin-sdk/app` surface: definePluginApp, the hooks, and
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
    // Diff components wrapped in the host's worker-pool gate; see
    // plugin-pierre-diffs-react.tsx.
    pierreDiffsReact: createGatedPierreDiffsReact(),
    clsx,
    tailwindMerge,
    classVarianceAuthority,
    sharedUiIcon,
  };
}

function isFrontendBundle(value: unknown): value is PluginFrontendBundle {
  if (typeof value !== "object" || value === null) return false;
  const bundle = value as Record<string, unknown>;
  return (
    typeof bundle.jsUrl === "string" &&
    (bundle.cssUrl === null || typeof bundle.cssUrl === "string") &&
    typeof bundle.jsBytes === "number" &&
    typeof bundle.hash === "string" &&
    typeof bundle.sdkMajor === "number" &&
    typeof bundle.sdkVersion === "string" &&
    typeof bundle.compatible === "boolean"
  );
}

/** Running plugins with a servable bundle, from GET /api/v1/plugins. */
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
      name?: unknown;
      icon?: unknown;
      status?: unknown;
      logoUrl?: unknown;
      logoDarkUrl?: unknown;
      iconUrl?: unknown;
      app?: { bundle?: unknown };
    } | null;
    if (typeof typed?.id !== "string") continue;
    const logoUrl = typeof typed.logoUrl === "string" ? typed.logoUrl : null;
    const logoDarkUrl =
      typeof typed.logoDarkUrl === "string" ? typed.logoDarkUrl : null;
    const compactIconUrl =
      typeof typed.iconUrl === "string" ? typed.iconUrl : null;
    const icon = typeof typed.icon === "string" ? typed.icon : null;
    const displayName = typeof typed.name === "string" ? typed.name : null;
    logoUrls.set(typed.id, {
      displayName,
      icon,
      compactIconUrl,
      logoUrl,
      logoDarkUrl,
    });
    if (typed.status !== "running") {
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

/**
 * Coalesce plugin stylesheet insertions into one animation frame. Each
 * `<link rel=stylesheet>` append invalidates document-wide style; bundles
 * finish importing at scattered moments, so without this every plugin costs
 * its own recalc. Removals (`url: null`) stay synchronous — teardown and
 * disposal must not leave a sheet behind — and cancel a pending insertion.
 * A newer URL for the same plugin replaces the pending one.
 */
export function createBatchedPluginCssApplier(args: {
  apply: (pluginId: string, url: string | null) => void;
  requestFrame: (callback: () => void) => void;
}): (pluginId: string, url: string | null) => void {
  const pending = new Map<string, string>();
  let frameRequested = false;
  const flush = () => {
    frameRequested = false;
    const batch = [...pending];
    pending.clear();
    for (const [pluginId, url] of batch) args.apply(pluginId, url);
  };
  return (pluginId, url) => {
    if (url === null) {
      pending.delete(pluginId);
      args.apply(pluginId, null);
      return;
    }
    pending.set(pluginId, url);
    if (frameRequested) return;
    frameRequested = true;
    args.requestFrame(flush);
  };
}

/** How many plugin bundles import at once during a reconcile pass. */
export const PLUGIN_FRONTEND_LOAD_CONCURRENCY = 3;

/**
 * Load order for a reconcile pass: the plugin owning the current panel route
 * first (its UI is what the page shows), then ascending bundle size so many
 * light plugins register before one heavy one. Stable for equal sizes.
 */
export function orderPluginFrontendCandidates(
  candidates: readonly PluginFrontendCandidate[],
  routePluginId: string | null,
): PluginFrontendCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.pluginId === routePluginId) return -1;
    if (right.pluginId === routePluginId) return 1;
    return left.bundle.jsBytes - right.bundle.jsBytes;
  });
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving start
 * order. The reconcile worker contains per-plugin failures itself; an
 * unexpected throw rejects this promise like `Promise.all` did before.
 */
export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  };
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => lane(),
  );
  await Promise.all(lanes);
}

// ---------------------------------------------------------------------------
// Reconcile: boot + live reload share one injectable state transition.
// ---------------------------------------------------------------------------

export interface PluginFrontendReconcileState {
  records: Map<string, PluginFrontendRecord>;
  /** Bundle hash last applied per plugin; an unchanged hash is a no-op. */
  appliedHashes: Map<string, string>;
  activeGenerations: Map<string, ActivePluginFrontendGeneration>;
  generationByPluginId: Map<string, number>;
  pendingControllers: Map<string, AbortController>;
  pendingStatusOwners: Map<string, symbol>;
  diagnostics: Map<string, PluginFrontendDiagnostic>;
  tornDown: boolean;
}

export function createPluginFrontendReconcileState(): PluginFrontendReconcileState {
  return {
    records: new Map(),
    appliedHashes: new Map(),
    activeGenerations: new Map(),
    generationByPluginId: new Map(),
    pendingControllers: new Map(),
    pendingStatusOwners: new Map(),
    diagnostics: new Map(),
    tornDown: false,
  };
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
  /**
   * Hold slot-store notifications while a reconcile run activates several
   * plugins; returns the closer. Production binds `beginPluginSlotBatch`.
   */
  beginSlotBatch: () => () => void;
  warn: (message: string) => void;
  /**
   * The plugin whose panel is the current route (`/plugins/:pluginId/...`),
   * or null. Its bundle imports first so the page the user asked for is not
   * queued behind unrelated plugins.
   */
  routePluginId: () => string | null;
  /** Test override; production allows 10s for async mount setup. */
  mountTimeoutMs?: number;
  diagnosticsChanged?: () => void;
}

interface MountedContentScript {
  id: string;
  dispose: PluginContentScriptDisposer | null;
}

interface ActivePluginFrontendGeneration {
  generation: number;
  hash: string;
  controller: AbortController;
  statusOwner: symbol;
  scripts: MountedContentScript[];
  disposed: boolean;
}

const DEFAULT_CONTENT_SCRIPT_MOUNT_TIMEOUT_MS = 10_000;

class ContentScriptMountError extends Error {
  constructor(
    readonly scriptId: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentScriptMountError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function publishDiagnostic(
  state: PluginFrontendReconcileState,
  deps: PluginFrontendReconcileDeps,
  diagnostic: PluginFrontendDiagnostic,
): void {
  state.diagnostics.set(diagnostic.pluginId, diagnostic);
  deps.diagnosticsChanged?.();
}

async function callDisposer(
  pluginId: string,
  scriptId: string,
  disposer: PluginContentScriptDisposer,
  deps: PluginFrontendReconcileDeps,
): Promise<PluginFrontendFailure | null> {
  try {
    await runWithPluginDomIsolationAsync(() => disposer(), pluginId);
    return null;
  } catch (error) {
    const message = errorMessage(error);
    deps.warn(
      `[plugin:${pluginId}] content script "${scriptId}" cleanup failed: ${message}`,
    );
    return { phase: "dispose", message, scriptId };
  }
}

async function disposeGeneration(
  pluginId: string,
  activation: ActivePluginFrontendGeneration,
  deps: PluginFrontendReconcileDeps,
): Promise<PluginFrontendFailure[]> {
  if (activation.disposed) return [];
  activation.disposed = true;
  activation.controller.abort();
  const failures: PluginFrontendFailure[] = [];
  for (const script of [...activation.scripts].reverse()) {
    if (script.dispose === null) continue;
    const failure = await callDisposer(
      pluginId,
      script.id,
      script.dispose,
      deps,
    );
    if (failure !== null) failures.push(failure);
  }
  clearPluginThreadRowStatusesByOwner(activation.statusOwner);
  return failures;
}

async function deactivateCommittedGeneration(
  pluginId: string,
  state: PluginFrontendReconcileState,
  deps: PluginFrontendReconcileDeps,
): Promise<PluginFrontendFailure[]> {
  const active = state.activeGenerations.get(pluginId);
  if (active === undefined) {
    clearPluginThreadRowStatuses(pluginId);
    return [];
  }
  const failures = await disposeGeneration(pluginId, active, deps);
  clearPluginThreadRowStatuses(pluginId);
  state.activeGenerations.delete(pluginId);
  state.appliedHashes.delete(pluginId);
  deps.removeRegistrations(pluginId);
  deps.applyCss(pluginId, null);
  return failures;
}

async function mountWithTimeout(
  pluginId: string,
  registration: PluginContentScriptRegistration,
  generation: number,
  controller: AbortController,
  statusOwner: symbol,
  deps: PluginFrontendReconcileDeps,
): Promise<PluginContentScriptDisposer | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const mountPromise = Promise.resolve().then(() =>
    runWithPluginDomIsolationAsync(
      () =>
        registration.mount({
          pluginId,
          generation,
          signal: controller.signal,
          experimental_setThreadRowStatus: (
            threadId: unknown,
            status: unknown,
          ) => {
            if (controller.signal.aborted) return;
            if (typeof threadId !== "string") {
              deps.warn(
                `bb plugin "${pluginId}": contentScript.experimental_setThreadRowStatus: "threadId" must be a non-empty string`,
              );
              return;
            }
            const normalizedThreadId = threadId.trim();
            if (normalizedThreadId.length === 0) {
              deps.warn(
                `bb plugin "${pluginId}": contentScript.experimental_setThreadRowStatus: "threadId" must be a non-empty string`,
              );
              return;
            }
            const normalizedStatus = normalizePluginThreadRowStatus(
              status,
              (reason) => deps.warn(`bb plugin "${pluginId}": ${reason}`),
            );
            if (normalizedStatus === undefined) return;
            setPluginThreadRowStatus(
              normalizedThreadId,
              pluginId,
              normalizedStatus,
              statusOwner,
            );
          },
        }),
      pluginId,
      controller.signal,
    ),
  );
  const timeoutMs =
    deps.mountTimeoutMs ?? DEFAULT_CONTENT_SCRIPT_MOUNT_TIMEOUT_MS;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new ContentScriptMountError(
          registration.id,
          `mount timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  });
  try {
    const disposer = await Promise.race([mountPromise, timeoutPromise]);
    if (disposer !== undefined && typeof disposer !== "function") {
      throw new ContentScriptMountError(
        registration.id,
        "mount must return a cleanup function, a promise of one, or nothing",
      );
    }
    return disposer ?? null;
  } catch (error) {
    if (error instanceof ContentScriptMountError) throw error;
    throw new ContentScriptMountError(registration.id, errorMessage(error));
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (timedOut) {
      void mountPromise
        .then(async (lateDisposer) => {
          if (typeof lateDisposer === "function") {
            await callDisposer(pluginId, registration.id, lateDisposer, deps);
          }
        })
        .catch(() => {});
    }
  }
}

async function activateContentScripts(
  pluginId: string,
  hash: string,
  generation: number,
  registrations: readonly PluginContentScriptRegistration[],
  controller: AbortController,
  statusOwner: symbol,
  deps: PluginFrontendReconcileDeps,
): Promise<
  | { ok: true; activation: ActivePluginFrontendGeneration }
  | { ok: false; failure: PluginFrontendFailure }
> {
  const activation: ActivePluginFrontendGeneration = {
    generation,
    hash,
    controller,
    statusOwner,
    scripts: [],
    disposed: false,
  };
  try {
    for (const registration of registrations) {
      const dispose = await mountWithTimeout(
        pluginId,
        registration,
        generation,
        controller,
        statusOwner,
        deps,
      );
      activation.scripts.push({ id: registration.id, dispose });
    }
    return { ok: true, activation };
  } catch (error) {
    controller.abort();
    await disposeGeneration(pluginId, activation, deps);
    const scriptId =
      error instanceof ContentScriptMountError ? error.scriptId : null;
    const message = errorMessage(error);
    deps.warn(
      `[plugin:${pluginId}] content script${scriptId === null ? "" : ` "${scriptId}"`} mount failed: ${message}`,
    );
    return {
      ok: false,
      failure: { phase: "mount", message, scriptId },
    };
  }
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
 * Replacement is transactional and never overlaps generations: bundle/setup
 * validation happens first, then the prior generation is aborted/disposed
 * before candidate scripts mount. A failed candidate is rolled back fully and
 * leaves no stale frontend bound to a replaced backend.
 */
export async function reconcilePluginFrontends(
  state: PluginFrontendReconcileState,
  deps: PluginFrontendReconcileDeps,
): Promise<void> {
  if (state.tornDown) return;
  const candidates = await deps.fetchCandidates();
  if (state.tornDown) return;
  const candidateIds = new Set(candidates.map((c) => c.pluginId));
  for (const pluginId of [...state.records.keys()]) {
    if (candidateIds.has(pluginId)) continue;
    state.pendingControllers.get(pluginId)?.abort();
    state.pendingControllers.delete(pluginId);
    await deactivateCommittedGeneration(pluginId, state, deps);
    state.records.delete(pluginId);
    state.appliedHashes.delete(pluginId);
    state.diagnostics.delete(pluginId);
    deps.diagnosticsChanged?.();
  }
  // One notification burst per run instead of one per plugin: every
  // `usePluginSlots` reader (timeline static context, markdown directive
  // registry, composer customizations, ...) would otherwise re-render once
  // per bundle as they resolve.
  const closeSlotBatch = deps.beginSlotBatch();
  try {
    await reconcileCandidates(candidates, state, deps);
  } finally {
    closeSlotBatch();
  }
}

async function reconcileCandidates(
  candidates: readonly PluginFrontendCandidate[],
  state: PluginFrontendReconcileState,
  deps: PluginFrontendReconcileDeps,
): Promise<void> {
  // Bounded, ordered loading: every bundle is a separate parse/eval on the
  // main thread and, on a phone, they used to all land during the window in
  // which the route chunk itself was still arriving. Three at a time keeps
  // the network busy without stacking a dozen evaluations, and the order
  // (route-owning plugin, then smallest first) gets the most useful and the
  // most plugins on screen earliest.
  await runWithConcurrencyLimit(
    orderPluginFrontendCandidates(candidates, deps.routePluginId()),
    PLUGIN_FRONTEND_LOAD_CONCURRENCY,
    async (candidate) => {
      const pluginId = candidate.pluginId;
      const previous = state.records.get(pluginId);
      if (
        previous !== undefined &&
        previous.status !== "failed" && // failed bundles retry (e.g. transient fetch error)
        state.appliedHashes.get(pluginId) === candidate.bundle.hash
      ) {
        return;
      }
      // A fixed plugin gets a fresh chance: clear crashed-slot latches before
      // the replaced registrations remount their boundaries.
      deps.resetCrashedSlots(pluginId);
      const loaded = await loadPluginFrontends([candidate], {
        importModule: deps.importModule,
        // CSS belongs to the committed generation. Import/setup validation does
        // not inject candidate styles; activation publishes them on success.
        injectCss: () => {},
        warn: deps.warn,
      });
      const record = loaded.get(pluginId);
      if (record === undefined) return;
      if (record.status === "failed") {
        await deactivateCommittedGeneration(pluginId, state, deps);
        state.records.set(pluginId, record);
        publishDiagnostic(state, deps, {
          pluginId,
          status: "failed",
          active: null,
          lastFailure: {
            phase: "load",
            message: record.error,
            scriptId: null,
          },
        });
        return;
      }
      if (record.status === "needs-update") {
        await deactivateCommittedGeneration(pluginId, state, deps);
        state.records.set(pluginId, record);
        publishDiagnostic(state, deps, {
          pluginId,
          status: "needs-update",
          active: null,
          sdkMajor: record.sdkMajor,
          sdkVersion: record.sdkVersion,
          lastFailure: null,
        });
        return;
      }

      let collected: ReturnType<typeof collectPluginAppRegistrations>;
      try {
        const definition = record.module.default;
        if (!isPluginAppDefinition(definition)) {
          throw new Error(
            "the bundle's default export is not definePluginApp(...) from @get-bb/plugin-sdk/app",
          );
        }
        collected = collectPluginAppRegistrations(definition, (reason) => {
          deps.warn(
            `[plugin:${pluginId}] composer customization rejected: ${reason}`,
          );
        });
      } catch (error) {
        const message = errorMessage(error);
        deps.warn(
          `[plugin:${pluginId}] frontend registration failed: ${message}`,
        );
        await deactivateCommittedGeneration(pluginId, state, deps);
        const failed: PluginFrontendRecord = {
          pluginId,
          status: "failed",
          error: message,
        };
        state.records.set(pluginId, failed);
        publishDiagnostic(state, deps, {
          pluginId,
          status: "failed",
          active: null,
          lastFailure: { phase: "setup", message, scriptId: null },
        });
        return;
      }

      const generation = (state.generationByPluginId.get(pluginId) ?? 0) + 1;
      state.generationByPluginId.set(pluginId, generation);
      const disposeFailures = await deactivateCommittedGeneration(
        pluginId,
        state,
        deps,
      );
      const controller = new AbortController();
      const statusOwner = Symbol(
        `${pluginId}:content-script-generation:${generation}`,
      );
      state.pendingControllers.set(pluginId, controller);
      state.pendingStatusOwners.set(pluginId, statusOwner);
      const activationResult = await activateContentScripts(
        pluginId,
        candidate.bundle.hash,
        generation,
        collected.contentScripts,
        controller,
        statusOwner,
        deps,
      );
      state.pendingControllers.delete(pluginId);
      state.pendingStatusOwners.delete(pluginId);
      if (state.tornDown) {
        if (activationResult.ok) {
          await disposeGeneration(pluginId, activationResult.activation, deps);
        }
        return;
      }
      if (!activationResult.ok) {
        const failed: PluginFrontendRecord = {
          pluginId,
          status: "failed",
          error: activationResult.failure.message,
        };
        state.records.set(pluginId, failed);
        publishDiagnostic(state, deps, {
          pluginId,
          status: "failed",
          active: null,
          lastFailure: activationResult.failure,
        });
        return;
      }

      state.activeGenerations.set(pluginId, activationResult.activation);
      deps.setRegistrations(pluginId, collected);
      deps.applyCss(pluginId, candidate.bundle.cssUrl);
      state.records.set(pluginId, record);
      state.appliedHashes.set(pluginId, candidate.bundle.hash);
      publishDiagnostic(state, deps, {
        pluginId,
        status: "active",
        active: {
          generation: activationResult.activation.generation,
          hash: activationResult.activation.hash,
          contentScriptIds: activationResult.activation.scripts.map(
            ({ id }) => id,
          ),
        },
        lastFailure: disposeFailures[0] ?? null,
      });
    },
  );
}

/**
 * Abort and dispose every active or activating generation in this app
 * window, then remove its slots and styles. Safe to call repeatedly.
 */
export async function disposePluginFrontends(
  state: PluginFrontendReconcileState,
  deps: PluginFrontendReconcileDeps,
): Promise<void> {
  state.tornDown = true;
  const pendingPluginIds = [...state.pendingControllers.keys()];
  for (const [pluginId, controller] of state.pendingControllers) {
    controller.abort();
    const statusOwner = state.pendingStatusOwners.get(pluginId);
    if (statusOwner !== undefined) {
      clearPluginThreadRowStatusesByOwner(statusOwner);
    }
  }
  state.pendingControllers.clear();
  state.pendingStatusOwners.clear();
  const pluginIds = new Set([
    ...pendingPluginIds,
    ...state.records.keys(),
    ...state.activeGenerations.keys(),
  ]);
  for (const pluginId of pluginIds) {
    const active = state.activeGenerations.get(pluginId);
    if (active !== undefined) {
      await disposeGeneration(pluginId, active, deps);
    }
    clearPluginThreadRowStatuses(pluginId);
    deps.removeRegistrations(pluginId);
    deps.applyCss(pluginId, null);
  }
  state.records.clear();
  state.appliedHashes.clear();
  state.activeGenerations.clear();
  state.diagnostics.clear();
  deps.diagnosticsChanged?.();
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
let browserDiagnosticsSnapshot: ReadonlyMap<string, PluginFrontendDiagnostic> =
  new Map();
const browserDiagnosticsListeners = new Set<() => void>();

function publishBrowserDiagnostics(): void {
  browserDiagnosticsSnapshot = new Map(state.diagnostics);
  for (const listener of browserDiagnosticsListeners) listener();
}

/**
 * Longest a reconcile run holds slot notifications: bundles that resolve
 * within this window flush together; a slow bundle cannot keep the others'
 * UI off screen past it.
 */
const PLUGIN_SLOT_BATCH_MAX_HOLD_MS = 150;

const browserReconcileDeps: PluginFrontendReconcileDeps = {
  fetchCandidates: fetchFrontendCandidates,
  importModule: (url) => import(/* @vite-ignore */ url),
  applyCss: createBatchedPluginCssApplier({
    apply: applyPluginCss,
    requestFrame: (callback) => {
      window.requestAnimationFrame(callback);
    },
  }),
  routePluginId: () => getPluginPanelRoutePluginId(window.location.pathname),
  resetCrashedSlots: resetCrashedPluginSlots,
  setRegistrations: setPluginSlotRegistrations,
  removeRegistrations: removePluginSlotRegistrations,
  beginSlotBatch: () =>
    beginPluginSlotBatch({ maxHoldMs: PLUGIN_SLOT_BATCH_MAX_HOLD_MS }),
  warn: (message) => console.warn(message),
  diagnosticsChanged: publishBrowserDiagnostics,
};

/** Current per-window lifecycle diagnostics for plugin frontend generations. */
export function getPluginFrontendDiagnostics(): ReadonlyMap<
  string,
  PluginFrontendDiagnostic
> {
  return browserDiagnosticsSnapshot;
}

/** Subscribe to per-window frontend diagnostic changes. */
export function subscribePluginFrontendDiagnostics(
  listener: () => void,
): () => void {
  browserDiagnosticsListeners.add(listener);
  return () => {
    browserDiagnosticsListeners.delete(listener);
  };
}

/** App-window teardown path; exported for lifecycle tests. */
export function teardownPluginFrontends(): Promise<void> {
  return disposePluginFrontends(state, browserReconcileDeps);
}

export interface PluginFrontendPageLifecycleDeps {
  isTornDown: () => boolean;
  /** Fresh boot after a teardown: resets boot state and reconciles. */
  reboot: () => void;
  /** Frontends survived the freeze; pick up plugin changes made meanwhile. */
  reconcile: () => void;
  teardown: () => void;
}

/**
 * Page lifecycle policy for plugin frontends. A `pagehide` with `persisted`
 * means the page is entering the back/forward cache: WebKit may restore it
 * without a reload, so the frontends stay mounted (tearing down would leave
 * a restored page with no plugin UI). Only a real unload tears down. On a
 * persisted `pageshow` the frontends either reconcile (still mounted) or,
 * if a teardown did happen, boot again.
 */
export function createPluginFrontendPageLifecycle(
  deps: PluginFrontendPageLifecycleDeps,
): {
  onPageHide: (event: { persisted: boolean }) => void;
  onPageShow: (event: { persisted: boolean }) => void;
} {
  return {
    onPageHide(event) {
      if (event.persisted) return;
      deps.teardown();
    },
    onPageShow(event) {
      if (!event.persisted) return;
      if (deps.isTornDown()) {
        deps.reboot();
        return;
      }
      deps.reconcile();
    },
  };
}

let pageLifecycleListenersInstalled = false;

function installPluginFrontendPageLifecycle(): void {
  if (pageLifecycleListenersInstalled) return;
  pageLifecycleListenersInstalled = true;
  const lifecycle = createPluginFrontendPageLifecycle({
    isTornDown: () => state.tornDown,
    reboot: () => {
      state.tornDown = false;
      bootPromise = null;
      void bootPluginFrontends();
    },
    reconcile: () => schedulePluginFrontendReconcile(),
    teardown: () => {
      void teardownPluginFrontends();
    },
  });
  window.addEventListener("pagehide", (event) => lifecycle.onPageHide(event));
  window.addEventListener("pageshow", (event) => lifecycle.onPageShow(event));
}

/**
 * Idempotent per page load. Called after system config resolves; runs entirely
 * off the first-paint path.
 */
export function bootPluginFrontends(): Promise<void> {
  bootPromise ??= (async () => {
    installPluginRuntime();
    installPluginFrontendPageLifecycle();
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
