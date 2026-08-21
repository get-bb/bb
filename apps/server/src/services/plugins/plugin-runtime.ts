import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  realpathSync,
  type FSWatcher,
} from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import { createJiti } from "jiti";
import semver from "semver";
import { HOST_ARTIFACT_MAX_BYTES } from "@bb/host-daemon-contract/protocol";
import {
  isPluginOwnedIconPath,
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
  type Thread,
} from "@bb/domain";
import {
  buildPluginApp,
  buildPluginHost,
  isIgnoredPluginDevPath,
} from "@bb/plugin-build";
import { DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS } from "@bb/host-daemon-contract";
import { PluginHostArtifactRegistry } from "./plugin-host-artifact-registry.js";
import { getPluginBuildToolchain } from "./build-toolchain.js";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  getInstalledPlugin,
  listInstalledPlugins,
  prunePluginSchedules,
  upsertPluginSchedule,
  type InstalledPluginRow,
} from "@bb/db";
import { toThreadResponseFromThread } from "../threads/thread-runtime-display.js";
import {
  loadPluginAppBundle,
  loadPluginBrandingAssets,
  parsePluginAppBundleMeta,
  readPluginAppBundleMeta,
  validatePluginArtifactMeta,
  type PluginAppBundleSnapshot,
  type PluginBrandingAssetSet,
} from "./app-bundle.js";
import { parsePluginSource } from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
import { buildPluginProviderRegistration } from "../providers/plugin-provider-registration.js";
import type { ProviderInstallRank } from "../providers/provider-registry.js";
import { BUNDLED_PLUGINS } from "./builtin-registry.js";
import { readPluginSettingsValuesSync } from "./plugin-settings.js";
import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import {
  isPluginSdkRangeSatisfied,
  pluginSdkRangeProblem,
} from "./sdk-compat.js";
import {
  createPluginApi,
  isNeedsConfigurationError,
  type BbPluginApi,
  type PluginThreadEventName,
  type PluginThreadEventPayloads,
} from "./plugin-api.js";
import type {
  LoadedPlugin,
  PluginHandlerStats,
  PluginRuntimeStatus,
  PluginServiceDeps,
  PluginHostArtifactSnapshot,
  PluginWireLookup,
  ServiceRuntime,
} from "./plugin-service-internal.js";
import { runEventLoopWork } from "../system/event-loop-work.js";

/**
 * Plugin server bundles keep `@get-bb/plugin-sdk` external (see @bb/plugin-build),
 * and plugin authors never have it installed — the scaffold maps the specifier
 * to bundled `.d.ts` files only. Source-checkout servers resolve the workspace
 * package naturally, but built and packaged servers have no node_modules copy,
 * so the server build ships a self-contained SDK runtime bundle next to the
 * server bundle and the loader aliases the specifier to it.
 */
const pluginSdkRuntimePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "plugin-sdk-runtime.js",
);
const PLUGIN_SDK_SPECIFIER = "@get-bb/plugin-sdk";

/**
 * Legacy alias for {@link PLUGIN_SDK_SPECIFIER}, kept so plugin server
 * artifacts built before the rename — and pre-rename plugin sources — still
 * resolve the SDK. It maps to the same runtime bundle; removed when the
 * migration window closes.
 */
const LEGACY_PLUGIN_SDK_SPECIFIER = "@bb/plugin-sdk";

async function hashFile(
  path: string,
): Promise<{ digest: string; byteLength: number }> {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    byteLength += chunk.byteLength;
    hash.update(chunk);
  }
  return { digest: hash.digest("hex"), byteLength };
}

/** Internal export for focused tests; not part of the service surface. */
export function pluginSdkAliasFor(runtimePath: string): Record<string, string> {
  return {
    [PLUGIN_SDK_SPECIFIER]: runtimePath,
    [LEGACY_PLUGIN_SDK_SPECIFIER]: runtimePath,
  };
}

const pluginSdkAlias: Record<string, string> | undefined = existsSync(
  pluginSdkRuntimePath,
)
  ? pluginSdkAliasFor(pluginSdkRuntimePath)
  : undefined;

/**
 * Per-root reload generation for mutable (path:/source-builtin) plugin trees.
 * `jiti.import` hands a `"type": "module"` entry to native `import()`, and
 * Node's ESM registry keys modules by resolved URL forever — so a re-import
 * after an edit returns the first-evaluated module and `bb plugin reload`
 * silently keeps the old code. A resolve hook stamps the current generation
 * onto every URL inside a mutable plugin root, which makes each reload a
 * distinct URL for the entry AND every file it imports.
 */
interface MutableRoot {
  /** Stable while the root stays registered; never reused after removal. */
  id: number;
  /** Process-wide unique load epoch, so a re-registered root cannot collide. */
  epoch: number;
}

const mutableRoots = new Map<string, MutableRoot>();
/** Marker shape: `<root id>.<epoch>`. */
const MUTABLE_ROOT_MARKER = /[?&]bbPluginLoad=(\d+)\.(\d+)/;
let nextMutableRootId = 1;
let nextMutableRootEpoch = 1;
let mutableRootHooks: { deregister: () => void } | null = null;

function registerMutableRootHooks(): void {
  if (mutableRootHooks !== null) return;
  mutableRootHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (mutableRoots.size === 0) return resolved;
      if (!resolved.url.startsWith("file:")) return resolved;
      // Longest match wins: a plugin nested inside another plugin's tree owns
      // its own files, and the outer root must not claim them.
      let match: MutableRoot | undefined;
      let matchedLength = 0;
      for (const [rootUrl, root] of mutableRoots) {
        if (rootUrl.length <= matchedLength) continue;
        if (!resolved.url.startsWith(rootUrl)) continue;
        match = root;
        matchedLength = rootUrl.length;
      }
      if (match === undefined) return resolved;
      // A plugin's own files keep the epoch of the parent that pulled them in,
      // so a later dynamic import from a still-active plugin cannot mix its
      // modules with those of a newer (or failed) load. The marker carries the
      // root id too: an import that crosses into a different plugin's tree
      // must take that plugin's epoch, not the importer's.
      const parent = MUTABLE_ROOT_MARKER.exec(context.parentURL ?? "");
      const epoch =
        parent !== null && Number(parent[1]) === match.id
          ? parent[2]
          : match.epoch;
      const separator = resolved.url.includes("?") ? "&" : "?";
      return {
        ...resolved,
        url: `${resolved.url}${separator}bbPluginLoad=${match.id}.${epoch}`,
        shortCircuit: true,
      };
    },
  });
}

/**
 * Node canonicalizes ESM files through symbolic links, so the tracked root
 * must be the real path — otherwise a symlinked install never matches and
 * reload silently serves cached code.
 */
const PROVIDER_ICON_CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Byte snapshot of a declared provider icon. Null when there is nothing to
 * snapshot — a named host glyph (`"Zap"`) has no file at all — and on any
 * failure for a plugin-owned path (missing file, unsupported extension, path
 * escaping the plugin root): the provider registers without a servable icon
 * rather than failing the plugin load.
 */
function readPluginProviderIcon(
  rootDir: string,
  icon: string | undefined,
): { bytes: Uint8Array; contentType: string } | null {
  if (icon === undefined || !isPluginOwnedIconPath(icon)) {
    return null;
  }
  const asset = icon;
  const contentType = PROVIDER_ICON_CONTENT_TYPES[extname(asset).toLowerCase()];
  if (contentType === undefined) {
    return null;
  }
  const resolved = resolve(rootDir, asset);
  // host-policy already rejects traversal in declarations; this containment
  // check is defense in depth for identity-backed roots.
  if (!resolved.startsWith(resolve(rootDir) + sep)) {
    return null;
  }
  try {
    return { bytes: new Uint8Array(readFileSync(resolved)), contentType };
  } catch {
    return null;
  }
}

function mutableRootDir(rootDir: string): string {
  try {
    return realpathSync(rootDir);
  } catch {
    // A vanished root fails later with a useful load error; the un-resolved
    // path is a good enough key until then.
    return rootDir;
  }
}

function mutableRootUrl(canonicalDir: string): string {
  return pathToFileURL(join(canonicalDir, "/")).href;
}

/**
 * The URL marker only re-keys ESM modules. Node caches a CommonJS child by
 * resolved filename and ignores the query, so a `.cjs` file (or anything
 * reached through `createRequire`) would survive the reload untouched. There
 * is one CommonJS cache per filename and no room for a per-epoch key, so the
 * evicted entries are returned and restored if the candidate never commits.
 */
function evictCommonJsCache(canonicalDir: string): Map<string, NodeModule> {
  const prefix = join(canonicalDir, "/");
  const cache = createRequire(import.meta.url).cache;
  const evicted = new Map<string, NodeModule>();
  for (const filename of Object.keys(cache)) {
    if (!filename.startsWith(prefix)) continue;
    const entry = cache[filename];
    if (entry !== undefined) evicted.set(filename, entry);
    delete cache[filename];
  }
  return evicted;
}

/**
 * Invalidate a mutable plugin tree so the next import re-reads from disk.
 * Returns a rollback for the candidate that never commits: the retained
 * plugin keeps its own epoch, so a cross-root import cannot reach the
 * rejected files, and its CommonJS children are put back as they were.
 */
function bumpMutableRootGeneration(rootDir: string): () => void {
  registerMutableRootHooks();
  const canonicalDir = mutableRootDir(rootDir);
  const rootUrl = mutableRootUrl(canonicalDir);
  const previous = mutableRoots.get(rootUrl);
  mutableRoots.set(rootUrl, {
    // A removed-then-reinstalled root takes a fresh id, so its new modules
    // can never collide with URLs the old registration already evaluated.
    id: previous?.id ?? nextMutableRootId++,
    epoch: nextMutableRootEpoch++,
  });
  const evicted = evictCommonJsCache(canonicalDir);
  return () => {
    if (previous === undefined) mutableRoots.delete(rootUrl);
    else mutableRoots.set(rootUrl, previous);
    const cache = createRequire(import.meta.url).cache;
    for (const [filename, entry] of evicted) {
      // Only restore what the failed candidate did not already replace.
      if (cache[filename] === undefined) cache[filename] = entry;
    }
  };
}

/**
 * Drop a root once its plugin is uninstalled, so the resolve hook does not
 * keep scanning roots that no longer exist. Reload must NOT call this: the
 * surviving module graph of a failed reload still resolves against its id.
 */
export function forgetMutableRoot(rootDir: string): void {
  releaseMutableRoots([mutableRootUrl(mutableRootDir(rootDir))]);
}

/**
 * Release roots owned by a stopping runtime and tear the hook down once no
 * roots remain, so a process that creates many services (tests, restarts)
 * does not pay for historical roots on every later resolve.
 */
function releaseMutableRoots(rootUrls: Iterable<string>): void {
  for (const rootUrl of rootUrls) mutableRoots.delete(rootUrl);
  if (mutableRoots.size > 0 || mutableRootHooks === null) return;
  mutableRootHooks.deregister();
  mutableRootHooks = null;
}

/** Which build target a dev build problem belongs to. */
type PluginDevBuildKind = "frontend" | "host";

const DEV_BUILD_PROBLEM_LABELS: Record<PluginDevBuildKind, string> = {
  frontend: "frontend bundle build failed",
  host: "host bundle build failed",
};

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_SERVICE_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SERVICE_RESTART_BASE_MS = 1_000;
const SERVICE_RESTART_MAX_MS = 60_000;
/** A crash after this much healthy runtime resets the backoff sequence. */
const SERVICE_HEALTHY_RESET_MS = 5 * 60_000;

/** One run of a background service, from runService to its settlement. */
interface ServiceInstance {
  id: string;
  service: ServiceRuntime;
  controller: AbortController;
  /** Set once an uncaught exception from this run has been claimed. */
  uncaughtError: { error: unknown } | undefined;
}

interface PluginRuntimeContext {
  deps: PluginServiceDeps;
  nextCronRunAt: (cron: string, now: number) => number;
  settledWithin: (
    promise: Promise<unknown>,
    timeoutMs: number,
  ) => Promise<boolean>;
}

/**
 * Keyed promise-chain mutex: calls for the same key run strictly serialized,
 * calls for different keys run independently. The chain entry is dropped once
 * its last task settles.
 */
function createKeyedLock() {
  const chains = new Map<string, Promise<void>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return result;
  };
}

export function createPluginRuntime(context: PluginRuntimeContext) {
  const { deps, nextCronRunAt, settledWithin } = context;
  const logger = deps.logger;
  const loadTimeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const serviceStopTimeoutMs =
    deps.serviceStopTimeoutMs ?? DEFAULT_SERVICE_STOP_TIMEOUT_MS;
  const serviceRestartBaseMs =
    deps.serviceRestartBaseMs ?? DEFAULT_SERVICE_RESTART_BASE_MS;

  const loaded = new Map<string, LoadedPlugin>();
  // A provider declaration remains useful when its host artifact fails: the
  // picker can keep a stable tab and explain that the provider is unavailable.
  // These registrations are deliberately separate from `loaded`, so no other
  // contribution from the failed plugin is published.
  const unavailableProviderRegistrations = new Map<
    string,
    Array<{ dispose(): void }>
  >();
  // Per-plugin lifecycle mutex: every load/dispose mutation for one plugin
  // runs strictly serialized. disposeOne removes the `loaded` entry before
  // stopServices finishes, so without this a concurrent reload/enable/
  // install could enter loadOne mid-dispose (no loaded entry, no hung
  // marker yet) and double-start the plugin's services.
  const withLifecycleLock = createKeyedLock();
  const withArtifactLock = createKeyedLock();
  const withPluginOperationLock = createKeyedLock();
  const REGISTRATION_MUTATION_KEY = "plugin-registration-mutations";
  const disposingPluginIds = new Set<string>();
  const builtinSourceWatchers: FSWatcher[] = [];
  /** Mutable roots this runtime registered, released when it stops. */
  const ownedRootUrls = new Set<string>();

  const statuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
  >();
  const baseStatuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
  >();
  const devBuildProblems = new Map<
    string,
    Partial<Record<PluginDevBuildKind, string>>
  >();
  const statusListeners = new Map<
    string,
    Set<(status: PluginRuntimeStatus, detail: string | null) => void>
  >();
  const stabilizingPluginIds = new Set<string>();
  // Frontend bundle snapshots (design §5.1), keyed by plugin id: the wire
  // state for list() plus the on-disk asset paths + content hash the asset
  // routes serve. Refreshed on every load (install/boot/reload).
  const appBundles = new Map<string, PluginAppBundleSnapshot>();
  // Shared with the composition root: provider-bridge launch resolution reads
  // the same artifacts the host RPC transport does.
  const hostArtifacts =
    deps.pluginHostArtifacts ?? new PluginHostArtifactRegistry();
  // Branding assets (compact icon + logo variants), refreshed alongside
  // appBundles on every load.
  const brandingAssets = new Map<string, PluginBrandingAssetSet>();
  // Static identity — parsed manifest + branding snapshots — for EVERY
  // installed plugin, loaded or not. Unlike `brandingAssets`/`appBundles`,
  // which are gated on the live runtime, this survives the load lifecycle so
  // the inventory and branding asset route can recognize disabled or
  // incompatible plugins. Refreshed on every load attempt; pruned on remove.
  const identities = new Map<
    string,
    { manifest: PluginManifest; brandingAssets: PluginBrandingAssetSet }
  >();
  // Services that ignored their abort past the stop bound. While a plugin
  // has entries here it is not re-loaded (that would double-start the
  // service); the marker clears when the hung start() finally settles.
  const hungServices = new Map<string, Set<string>>();
  // needs-configuration messages reported during the current load; cleared
  // on the next load so a reconfigured plugin comes back as running.
  const needsConfiguration = new Map<string, string>();
  // Agent-tool registration problems (cross-plugin name collisions): the
  // plugin keeps running, but the dropped registration is surfaced as its
  // status detail. Cleared on the next load.
  const agentToolProblems = new Map<string, string>();
  // Cumulative per plugin for this server session (kept across reloads so a
  // reload cannot hide cost); removed with the plugin registration.
  const handlerStats = new Map<string, PluginHandlerStats>();
  // Bound once the HTTP listener is up; bb.sdk is gated on it (design §3
  // two-phase load/bind). One shared instance — plugin-api wraps it per
  // plugin for spawn attribution.
  let boundSdk: BbSdk | undefined;
  // The server's own loopback base URL, bound alongside the SDK; backs the
  // bind-gated bb.server.loopbackBaseUrl.
  let boundLoopbackBaseUrl: string | undefined;

  function publishStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null,
  ): void {
    statuses.set(id, { status, detail });
    for (const listener of statusListeners.get(id) ?? []) {
      listener(status, detail);
    }
  }

  function setStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null = null,
  ): void {
    baseStatuses.set(id, { status, detail });
    const buildProblems = devBuildProblems.get(id);
    publishStatus(
      id,
      status,
      [detail, buildProblems?.frontend, buildProblems?.host]
        .filter((part): part is string => part !== null && part !== undefined)
        .join("; ") || null,
    );
  }

  function setDevBuildProblem(
    id: string,
    kind: PluginDevBuildKind,
    message: string | null,
  ): void {
    const problems = devBuildProblems.get(id) ?? {};
    if (message === null) {
      if (problems[kind] === undefined) return;
      delete problems[kind];
    } else {
      problems[kind] = `${DEV_BUILD_PROBLEM_LABELS[kind]}: ${message}`;
    }
    if (Object.keys(problems).length === 0) devBuildProblems.delete(id);
    else devBuildProblems.set(id, problems);
    const base = baseStatuses.get(id);
    if (base !== undefined) setStatus(id, base.status, base.detail);
  }

  function statsFor(id: string): PluginHandlerStats {
    let stats = handlerStats.get(id);
    if (!stats) {
      stats = { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 };
      handlerStats.set(id, stats);
    }
    return stats;
  }

  function reportNeedsConfiguration(id: string, message: string): void {
    needsConfiguration.set(id, message);
    setStatus(id, "needs-configuration", message);
  }

  function reportAgentToolProblem(id: string, message: string): void {
    agentToolProblems.set(id, message);
    logger.warn(`[plugin:${id}] ${message}`);
    // Post-load registration (mid-session): surface the detail right away.
    // During load, loadOne applies it when it sets the final status.
    if (statuses.get(id)?.status === "running") {
      setStatus(id, "running", message);
    }
  }

  /** Another loaded plugin already owns this tool name? Returns its id. */
  function findAgentToolOwner(
    name: string,
    excludePluginId: string,
  ): string | undefined {
    for (const [otherId, plugin] of loaded) {
      if (otherId === excludePluginId) continue;
      if (plugin.handle.agentTools.some((tool) => tool.name === name)) {
        return otherId;
      }
    }
    return undefined;
  }

  /**
   * The service instance whose async context is executing. Plugins run
   * in-process, so an error a service raises outside its start() promise
   * (an unlistened EventEmitter 'error', a throw in a timer callback, a
   * detached rejection) reaches the process as an uncaught exception, not
   * the promise chain runService watches. The store follows every timer,
   * socket callback, and promise the service creates, so
   * handleUncaughtException can hand the error back to the supervisor.
   */
  const serviceContext = new AsyncLocalStorage<ServiceInstance>();

  /** Start (or restart) one background service instance. */
  function runService(id: string, service: ServiceRuntime): void {
    const controller = new AbortController();
    service.controller = controller;
    service.state = "running";
    service.startedAt = Date.now();
    const instance: ServiceInstance = {
      id,
      service,
      controller,
      uncaughtError: undefined,
    };
    // The async wrapper normalizes sync throws from start() into rejections.
    const current = serviceContext.run(instance, async () => {
      await service.record.start(controller.signal);
    });
    service.current = current;
    current.then(
      () =>
        instance.uncaughtError === undefined
          ? onServiceSettled(id, service, { crashed: false })
          : onServiceSettled(id, service, {
              crashed: true,
              error: instance.uncaughtError.error,
            }),
      (error: unknown) =>
        onServiceSettled(id, service, {
          crashed: true,
          // The out-of-band error came first; a rejection after the abort
          // is its consequence.
          error: instance.uncaughtError?.error ?? error,
        }),
    );
  }

  /**
   * Claims an uncaught exception raised from a service's async context.
   * Returns false when no service owns it, so the caller keeps Node's
   * default and exits. A live instance is aborted; its settlement then
   * takes the crash path (backoff + restart) with this error as the cause.
   */
  function handleUncaughtException(error: unknown): boolean {
    const instance = serviceContext.getStore();
    if (instance === undefined) return false;
    const { id, service, controller } = instance;
    const name = service.record.name;
    const message = error instanceof Error ? error.message : String(error);
    if (service.controller !== controller || service.disposed) {
      // A previous run (restarted or disposed) left a timer or emitter behind.
      logger.warn(
        `[plugin:${id}] service ${name} raised an uncaught exception from a stopped run: ${message}`,
      );
      return true;
    }
    if (instance.uncaughtError !== undefined) return true;
    instance.uncaughtError = { error };
    logger.warn(
      { err: error },
      `[plugin:${id}] service ${name} raised an uncaught exception outside start(): ${message} — aborting it`,
    );
    const current = service.current;
    controller.abort();
    if (current === null) return true;
    void settledWithin(current, serviceStopTimeoutMs).then((settled) => {
      if (settled || service.controller !== controller || service.disposed) {
        return;
      }
      setStatus(
        id,
        "degraded",
        `service ${name} did not stop after an uncaught exception`,
      );
      logger.warn(
        `[plugin:${id}] service ${name} did not stop within ${serviceStopTimeoutMs}ms of its uncaught exception — plugin degraded until it does`,
      );
    });
    return true;
  }

  function onServiceSettled(
    id: string,
    service: ServiceRuntime,
    outcome: { crashed: false } | { crashed: true; error: unknown },
  ): void {
    service.current = null;
    service.controller = null;
    if (service.disposed) return; // the dispose path owns state + logging
    const name = service.record.name;
    if (!outcome.crashed) {
      // Resolved without being aborted: the service chose to stop.
      service.state = "stopped";
      logger.info(`[plugin:${id}] service ${name} stopped`);
      return;
    }
    if (isNeedsConfigurationError(outcome.error)) {
      service.state = "stopped";
      reportNeedsConfiguration(
        id,
        outcome.error.message || `service ${name} needs configuration`,
      );
      logger.info(
        `[plugin:${id}] service ${name} needs configuration; not restarting until reload`,
      );
      return;
    }
    // Crash → restart with capped exponential backoff; a crash after a
    // healthy stretch restarts the sequence from the base delay.
    const message =
      outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error);
    if (stabilizingPluginIds.has(id)) {
      service.state = "stopped";
      setStatus(id, "error", `service ${name} crashed: ${message}`);
      logger.warn(
        `[plugin:${id}] service ${name} crashed during activation: ${message}`,
      );
      return;
    }
    if (Date.now() - service.startedAt >= SERVICE_HEALTHY_RESET_MS) {
      service.consecutiveCrashes = 0;
    }
    const delayMs = Math.min(
      serviceRestartBaseMs * 2 ** service.consecutiveCrashes,
      SERVICE_RESTART_MAX_MS,
    );
    service.consecutiveCrashes += 1;
    service.state = "backoff";
    logger.warn(
      `[plugin:${id}] service ${name} crashed: ${message} — restarting in ${delayMs}ms`,
    );
    const timer = setTimeout(() => {
      service.restartTimer = null;
      if (!service.disposed) runService(id, service);
    }, delayMs);
    timer.unref?.();
    service.restartTimer = timer;
  }

  /**
   * §3 reload sequence step 1: abort every service, then await each start()
   * promise with a bounded timeout. A service that does not stop marks the
   * plugin degraded and blocks re-load until its promise finally settles.
   */
  async function stopServices(id: string, plugin: LoadedPlugin): Promise<void> {
    for (const service of plugin.services) {
      service.disposed = true;
      if (service.restartTimer !== null) {
        clearTimeout(service.restartTimer);
        service.restartTimer = null;
      }
      service.controller?.abort();
    }
    for (const service of plugin.services) {
      const current = service.current;
      const name = service.record.name;
      if (current !== null) {
        const stopped = await settledWithin(current, serviceStopTimeoutMs);
        if (!stopped) {
          let hung = hungServices.get(id);
          if (!hung) {
            hung = new Set();
            hungServices.set(id, hung);
          }
          hung.add(name);
          setStatus(id, "degraded", `service ${name} did not stop`);
          logger.warn(
            `[plugin:${id}] service ${name} did not stop within ${serviceStopTimeoutMs}ms — plugin degraded until it does`,
          );
          void current.then(
            () => onHungServiceSettled(id, name),
            () => onHungServiceSettled(id, name),
          );
        }
      }
      service.state = "stopped";
    }
  }

  function onHungServiceSettled(id: string, name: string): void {
    const hung = hungServices.get(id);
    if (!hung) return;
    hung.delete(name);
    if (hung.size === 0) hungServices.delete(id);
    logger.info(
      `[plugin:${id}] service ${name} eventually stopped — reload to recover`,
    );
  }

  function hasThreadEventHandlers(event: PluginThreadEventName): boolean {
    if (loaded.size === 0) return false;
    for (const plugin of loaded.values()) {
      if (plugin.handle.threadEventHandlers[event].length > 0) return true;
    }
    return false;
  }

  /**
   * One wrapped plugin-handler invocation (design §3 failure isolation):
   * caught, logged, wall-time recorded into handlerStats. Shared by thread
   * events and the wire surfaces (http routes, rpc methods).
   */
  /** In-flight invokeWrapped markers per plugin, drained during dispose. */
  const pendingInvocations = new Map<string, Set<Promise<void>>>();

  async function invokeWrapped<T>(
    id: string,
    label: string,
    run: () => T | Promise<T>,
  ): Promise<
    { ok: true; value: T } | { ok: false; error: string; cause: unknown }
  > {
    const stats = statsFor(id);
    const startedAt = performance.now();
    let settle!: () => void;
    const marker = new Promise<void>((resolveMarker) => {
      settle = resolveMarker;
    });
    let pending = pendingInvocations.get(id);
    if (!pending) {
      pending = new Set();
      pendingInvocations.set(id, pending);
    }
    pending.add(marker);
    try {
      return {
        ok: true,
        value: await runEventLoopWork(`plugin:${id} ${label}`, run),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.errorCount += 1;
      logger.warn(`[plugin:${id}] ${label} failed: ${message}`);
      if (statuses.get(id)?.status === "running") {
        setStatus(id, "running", `${label} failed: ${message}`);
      }
      return { ok: false, error: message, cause: error };
    } finally {
      const elapsedMs = performance.now() - startedAt;
      stats.count += 1;
      stats.totalMs += elapsedMs;
      if (elapsedMs > stats.maxMs) stats.maxMs = elapsedMs;
      pending.delete(marker);
      settle();
    }
  }

  /**
   * Reload sequence step 3 (design §3): bounded wait for in-flight handler
   * invocations so dispose does not close database handles or invalidate the
   * API under a still-running rpc/http/event handler.
   */
  async function drainInvocations(id: string): Promise<void> {
    const pending = pendingInvocations.get(id);
    if (!pending || pending.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.all([...pending]).then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), serviceStopTimeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!drained) {
      logger.warn(
        `plugin ${id}: ${pending.size} in-flight invocation(s) did not settle before dispose; proceeding`,
      );
    }
    if (pending.size === 0) pendingInvocations.delete(id);
  }

  /**
   * Fire-and-forget dispatch: the lifecycle seam returns immediately; the
   * payload is assembled and handlers run on the next macrotask, after the
   * transition (and any surrounding transaction) has settled. Handlers are
   * looked up live at dispatch time, so a plugin disposed in between
   * receives nothing.
   */
  function emitThreadEvent<E extends PluginThreadEventName>(
    event: E,
    buildPayload: () => PluginThreadEventPayloads[E],
  ): void {
    if (!hasThreadEventHandlers(event)) return;
    setImmediate(() => {
      let payload: PluginThreadEventPayloads[E];
      try {
        payload = buildPayload();
      } catch (error) {
        logger.warn(
          `failed to build ${event} plugin event payload: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      for (const [id, plugin] of loaded) {
        for (const handler of [...plugin.handle.threadEventHandlers[event]]) {
          void invokeWrapped(id, `${event} handler`, () => handler(payload));
        }
      }
    });
  }

  function buildThreadDto(thread: Thread) {
    return toThreadResponseFromThread(
      { db: deps.db, hub: deps.hub },
      { thread },
    );
  }

  function checkEngineRange(manifest: PluginManifest): string | undefined {
    if (!manifest.bbEngineRange) return undefined;
    const version = semver.coerce(deps.appVersion);
    if (!version) {
      // Dev builds may carry a non-semver version; do not block on it.
      logger.warn(
        `cannot parse app version "${deps.appVersion}" for engines check; skipping`,
      );
      return undefined;
    }
    if (version.major === 0 && version.minor === 0 && version.patch === 0) {
      // Dev servers report 0.0.0 (or 0.0.0-test); a real release never does.
      // Enforcing ranges against it would mark every version-gated plugin
      // incompatible in development.
      return undefined;
    }
    if (!semver.satisfies(version, manifest.bbEngineRange)) {
      return `requires bb ${manifest.bbEngineRange}, this is ${version.version}`;
    }
    return undefined;
  }

  function checkPluginSdkRange(manifest: PluginManifest): string | undefined {
    if (!manifest.bbPluginSdkRange) return undefined;
    if (!isPluginSdkRangeSatisfied(manifest.bbPluginSdkRange)) {
      return pluginSdkRangeProblem(manifest.bbPluginSdkRange);
    }
    return undefined;
  }

  async function runFactoryTimeBoxed(
    factory: (api: BbPluginApi) => unknown,
    api: BbPluginApi,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve(factory(api)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`load timed out after ${loadTimeoutMs}ms`)),
            loadTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Parse an incoming install display spec for validation/build policy. */
  function sourceKind(source: string): "path" | "git" | "npm" | "builtin" {
    try {
      return parsePluginSource(source).kind;
    } catch {
      return "path";
    }
  }

  function isPackagedBuiltinEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
    artifact: "app" | "server" | "host";
  }): boolean {
    const entry = {
      app: args.manifest.appEntry,
      server: args.manifest.serverEntry,
      host: args.manifest.hostEntry,
    }[args.artifact];
    return (
      args.kind === "builtin" &&
      entry === resolve(args.rootDir, "dist", `${args.artifact}.js`)
    );
  }

  async function packagedBuiltinArtifactProblem(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string | null> {
    const kind = sourceKind(row.source);
    if (
      !isPackagedBuiltinEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
        artifact: "server",
      })
    ) {
      return null;
    }
    async function validate(
      artifact: "server" | "app" | "host",
    ): Promise<string | null> {
      let raw: string;
      try {
        raw = await readFile(
          join(row.rootDir, "dist", `${artifact}.meta.json`),
          "utf8",
        );
      } catch {
        return `${artifact} artifact for plugin "${manifest.id}" is missing dist/${artifact}.meta.json`;
      }
      return validatePluginArtifactMeta({
        artifact,
        raw,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
      });
    }
    const serverProblem = await validate("server");
    if (serverProblem !== null) return serverProblem;
    if (
      isPackagedBuiltinEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
        artifact: "app",
      })
    ) {
      const appProblem = await validate("app");
      if (appProblem !== null) return appProblem;
    }
    if (
      isPackagedBuiltinEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
        artifact: "host",
      })
    ) {
      return validate("host");
    }
    return null;
  }

  function isBuiltinPluginId(id: string): boolean {
    const row = getInstalledPlugin(deps.db, id);
    return row !== undefined && row.provenance === "builtin";
  }

  function isPrebuiltServerSdkCompatible(
    meta: { sdkMajor: number; sdkVersion: string } | null,
  ): boolean {
    if (meta === null) return false;
    if (meta.sdkMajor !== PLUGIN_SDK_MAJOR) return false;
    if (PLUGIN_SDK_MAJOR === 0) return meta.sdkVersion === PLUGIN_SDK_VERSION;
    return true;
  }

  /**
   * Mutable plugin app artifacts are only a cache of their source tree. A
   * watcher can rebuild edits made while the server is running, but startup
   * must also catch edits made while it was stopped. Directory mtimes matter
   * because deleting a source file changes its parent rather than another
   * surviving file.
   */
  async function isMutableAppBundleStale(rootDir: string): Promise<boolean> {
    let artifactMtimeMs: number;
    try {
      artifactMtimeMs = (await stat(join(rootDir, "dist", "app.js"))).mtimeMs;
    } catch {
      return true;
    }

    const pendingDirectories = [""];
    while (pendingDirectories.length > 0) {
      const relativeDirectory = pendingDirectories.pop();
      if (relativeDirectory === undefined) break;
      const directory = join(rootDir, relativeDirectory);
      let entries;
      try {
        const directoryStats = await stat(directory);
        if (directoryStats.mtimeMs > artifactMtimeMs) return true;
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        // The tree changed while it was scanned. Rebuilding is the safe
        // outcome, and the build will report any lasting filesystem problem.
        return true;
      }

      for (const entry of entries) {
        const relativePath = join(relativeDirectory, entry.name);
        if (isIgnoredPluginDevPath(relativePath)) continue;
        try {
          const entryStats = await stat(join(rootDir, relativePath));
          if (entryStats.mtimeMs > artifactMtimeMs) return true;
        } catch {
          return true;
        }
        if (entry.isDirectory()) pendingDirectories.push(relativePath);
      }
    }
    return false;
  }

  /**
   * The backend entry to import for this load. Managed (git:/npm:) installs
   * prefer a fresh, SDK-compatible prebuilt `dist/server.js` (design
   * §3 loader amendment, §6 prebuilt distribution) so consumers never need
   * npm or node_modules. Path installs and source-layout builtins ALWAYS load
   * from source, so author iteration via `bb plugin reload` and the builtin
   * dev watcher sees edited files; packaged builtins declare dist/server.js
   * as their manifest entry and still load that artifact. A present-but-stale
   * or meta-less managed dist falls back to source with one warning. While
   * the SDK is pre-1.0, minor bumps are breaking (semver), so compatibility
   * requires the exact SDK version, not just a matching major.
   */
  async function resolveServerEntry(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string> {
    if (
      row.sourceKind === "path" ||
      (row.sourceKind === "builtin" &&
        !isPackagedBuiltinEntry({
          kind: row.sourceKind,
          manifest,
          rootDir: row.rootDir,
          artifact: "server",
        }))
    ) {
      return manifest.serverEntry;
    }
    const distJsPath = join(row.rootDir, "dist", "server.js");
    try {
      await stat(distJsPath);
    } catch {
      return manifest.serverEntry; // no prebuilt bundle shipped — normal
    }
    let meta: { sdkMajor: number; sdkVersion: string } | null = null;
    try {
      meta = parsePluginAppBundleMeta(
        await readFile(join(row.rootDir, "dist", "server.meta.json"), "utf8"),
      );
    } catch {
      // missing sidecar → meta stays null
    }
    if (!isPrebuiltServerSdkCompatible(meta)) {
      logger.warn(
        `plugin ${row.id}: ignoring prebuilt dist/server.js (built with SDK ${meta?.sdkVersion ?? "unknown"}, running SDK is ${PLUGIN_SDK_VERSION}) — loading from source`,
      );
      return manifest.serverEntry;
    }
    return distJsPath;
  }

  /**
   * Refresh a plugin's frontend-bundle snapshot for this load (design §5.1).
   * Mutable path installs and source-layout builtins are rebuilt when the
   * recorded SDK version differs from the running one or their source changed
   * after the last build. Managed git/npm artifacts are immutable after
   * promotion and are served exactly as validated; incompatible metadata is
   * surfaced without rewriting cached bytes.
   */
  async function loadAppBundleCandidate(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<{
    snapshot: PluginAppBundleSnapshot;
    problem: string | null;
  }> {
    if (manifest.appEntry === undefined) {
      return {
        snapshot: { state: { hasApp: false, bundle: null }, assets: null },
        problem: null,
      };
    }
    const kind = row.sourceKind;
    if (
      (kind === "path" || kind === "builtin") &&
      !isPackagedBuiltinEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
        artifact: "app",
      })
    ) {
      const meta = await readPluginAppBundleMeta(row.rootDir);
      const sdkChanged = meta?.sdkVersion !== PLUGIN_SDK_VERSION;
      const sourceChanged =
        !sdkChanged && (await isMutableAppBundleStale(row.rootDir));
      if (sdkChanged || sourceChanged) {
        const reason = sdkChanged
          ? `built with SDK ${meta?.sdkVersion ?? "unknown"}, running SDK is ${PLUGIN_SDK_VERSION}`
          : "plugin source is newer than dist/app.js";
        logger.info(`plugin ${row.id}: rebuilding frontend bundle (${reason})`);
        try {
          await buildPluginApp(
            row.rootDir,
            deps.appVersion,
            await getPluginBuildToolchain(deps),
          );
          setDevBuildProblem(row.id, "frontend", null);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            `plugin ${row.id}: frontend bundle rebuild failed: ${message}`,
          );
          return {
            snapshot: { state: { hasApp: true, bundle: null }, assets: null },
            problem: `frontend bundle rebuild failed: ${message}`,
          };
        }
      }
    }
    return {
      snapshot: await loadPluginAppBundle(row.id, row.rootDir),
      problem: null,
    };
  }

  async function loadHostArtifactCandidate(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<PluginHostArtifactSnapshot | null> {
    if (manifest.hostEntry === undefined) return null;
    const kind = row.sourceKind;
    if (
      (kind === "path" || kind === "builtin") &&
      !isPackagedBuiltinEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
        artifact: "host",
      })
    ) {
      await buildPluginHost(
        row.rootDir,
        deps.appVersion,
        await getPluginBuildToolchain(deps),
      );
      // A successful rebuild through the load path (enable/reload) must clear
      // a stale dev-loop failure, or it sticks until the next source change.
      setDevBuildProblem(row.id, "host", null);
    }
    const jsPath = join(row.rootDir, "dist", "host.js");
    const metaPath = join(row.rootDir, "dist", "host.meta.json");
    const artifactStats = await stat(jsPath).catch((error) => {
      throw new Error(
        `host artifact for plugin "${manifest.id}" is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (artifactStats.size > HOST_ARTIFACT_MAX_BYTES) {
      throw new Error(
        `host artifact for plugin "${manifest.id}" exceeds the ${HOST_ARTIFACT_MAX_BYTES} byte limit`,
      );
    }
    const [artifact, rawMeta] = await Promise.all([
      hashFile(jsPath),
      readFile(metaPath, "utf8"),
    ]).catch((error) => {
      throw new Error(
        `host artifact for plugin "${manifest.id}" is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (artifact.byteLength > HOST_ARTIFACT_MAX_BYTES) {
      throw new Error(
        `host artifact for plugin "${manifest.id}" exceeds the ${HOST_ARTIFACT_MAX_BYTES} byte limit`,
      );
    }
    const metadataProblem = validatePluginArtifactMeta({
      artifact: "host",
      raw: rawMeta,
      pluginId: manifest.id,
      pluginVersion: manifest.version,
    });
    if (metadataProblem !== null) throw new Error(metadataProblem);
    let declaredDigest: unknown;
    try {
      const parsed: unknown = JSON.parse(rawMeta);
      declaredDigest =
        typeof parsed === "object" && parsed !== null
          ? Reflect.get(parsed, "artifactDigest")
          : undefined;
    } catch {
      declaredDigest = undefined;
    }
    const digest = artifact.digest;
    if (declaredDigest !== digest) {
      throw new Error(
        `host artifact for plugin "${manifest.id}" has digest ${String(declaredDigest)}, expected ${digest}`,
      );
    }
    return {
      path: jsPath,
      byteLength: artifact.byteLength,
      digest,
      generation: randomUUID(),
    };
  }

  // Best-effort static identity for the inventory + logo asset route,
  // independent of whether the plugin loads. A plugin whose manifest can't be
  // read (missing/corrupt) simply has no identity to show — it falls back to
  // its id and the generic glyph.
  async function populateIdentity(row: InstalledPluginRow): Promise<void> {
    try {
      const manifest = await readPluginManifest(row.rootDir);
      identities.set(row.id, {
        manifest,
        brandingAssets: await loadPluginBrandingAssets(row.id, manifest),
      });
    } catch {
      identities.delete(row.id);
    }
  }

  function disposeUnavailableProviderRegistrations(pluginId: string): void {
    const registrations = unavailableProviderRegistrations.get(pluginId);
    if (registrations === undefined) return;
    unavailableProviderRegistrations.delete(pluginId);
    for (const registration of registrations) registration.dispose();
  }

  /**
   * Where this plugin sits in install order: bundled plugins rank by their
   * bundled position (they install first, at bootstrap), everything else by
   * install time. This is the provider picker's order absent a user setting.
   */
  function providerInstallRank(row: InstalledPluginRow): ProviderInstallRank {
    const name = row.sourceKind === "builtin" ? row.sourceBuiltinName : null;
    const bundledIndex =
      name === null
        ? -1
        : BUNDLED_PLUGINS.findIndex((plugin) => plugin.name === name);
    return {
      bundledIndex: bundledIndex === -1 ? null : bundledIndex,
      installedAt: row.installedAt,
    };
  }

  function registerPluginProvider(args: {
    available: boolean;
    declaration: PluginProviderDeclaration;
    row: InstalledPluginRow;
    settingsDescriptors: PluginSettingDescriptors;
  }): { dispose(): void } {
    if (!deps.providerRegistry) {
      throw new Error("the provider registry is unavailable in this host");
    }
    const icon = readPluginProviderIcon(
      args.row.rootDir,
      args.declaration.icon,
    );
    return deps.providerRegistry.register({
      ...buildPluginProviderRegistration({
        available: args.available,
        pluginId: args.row.id,
        declaration: args.declaration,
        readSettings: () =>
          readPluginSettingsValuesSync({
            db: deps.db,
            pluginId: args.row.id,
            descriptors: args.settingsDescriptors,
          }),
      }),
      ...(icon === null ? {} : { icon }),
      pluginId: args.row.id,
      installRank: providerInstallRank(args.row),
    });
  }

  function replaceUnavailableProviderRegistrations(
    row: InstalledPluginRow,
    declarations: readonly PluginProviderDeclaration[],
    settingsDescriptors: PluginSettingDescriptors,
  ): void {
    disposeUnavailableProviderRegistrations(row.id);
    const registrations: Array<{ dispose(): void }> = [];
    try {
      for (const declaration of declarations) {
        registrations.push(
          registerPluginProvider({
            available: false,
            declaration,
            row,
            settingsDescriptors,
          }),
        );
      }
    } catch (error) {
      for (const registration of registrations) registration.dispose();
      throw error;
    }
    if (registrations.length > 0) {
      unavailableProviderRegistrations.set(row.id, registrations);
    }
  }

  async function loadOne(row: InstalledPluginRow): Promise<void> {
    // Refresh identity first so even a disabled/incompatible/errored plugin
    // keeps its name, icon, and logo in the list.
    await populateIdentity(row);
    if (!row.enabled) {
      setStatus(row.id, "disabled");
      return;
    }
    const previous = loaded.get(row.id);
    function failBeforeFactory(
      status: PluginRuntimeStatus,
      detail: string,
    ): void {
      // Every non-running outcome must leave a log line: without one, an
      // engines mismatch after a host upgrade leaves the plugin gone with
      // no trace outside the in-memory status (#1915).
      if (previous !== undefined) {
        setStatus(row.id, "running", `reload failed: ${detail}`);
        logger.warn(
          `plugin ${row.id} reload failed (kept previous instance): ${detail}`,
        );
      } else {
        setStatus(row.id, status, detail);
        logger.warn(`plugin ${row.id} not loaded (${status}): ${detail}`);
      }
    }
    const hung = hungServices.get(row.id);
    if (hung !== undefined && hung.size > 0) {
      // A previous instance's service never stopped; loading now would
      // double-start it (design §3: degraded rather than double-starting).
      const detail = `service ${[...hung].join(", ")} did not stop`;
      setStatus(row.id, "degraded", detail);
      logger.warn(`plugin ${row.id} not loaded (degraded): ${detail}`);
      return;
    }
    try {
      await stat(row.rootDir);
    } catch {
      failBeforeFactory(
        "missing",
        `plugin directory not found: ${row.rootDir} (reinstall)`,
      );
      return;
    }
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(row.rootDir);
    } catch (error) {
      failBeforeFactory(
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const engineProblem =
      checkEngineRange(manifest) ?? checkPluginSdkRange(manifest);
    if (engineProblem) {
      failBeforeFactory("incompatible", engineProblem);
      return;
    }
    const artifactProblem = await packagedBuiltinArtifactProblem(row, manifest);
    if (artifactProblem !== null) {
      failBeforeFactory("incompatible", artifactProblem);
      return;
    }
    // Build candidate assets without publishing them; a failed reload keeps
    // the previous backend and frontend registration sets together.
    const appBundleCandidate = await loadAppBundleCandidate(row, manifest);
    let hostArtifactCandidate: PluginHostArtifactSnapshot | null = null;
    let hostArtifactProblem: string | null = null;
    try {
      hostArtifactCandidate = await loadHostArtifactCandidate(row, manifest);
    } catch (error) {
      hostArtifactProblem =
        error instanceof Error ? error.message : String(error);
      if (previous !== undefined) {
        failBeforeFactory("error", hostArtifactProblem);
        return;
      }
    }
    // Branding refresh rides every load too, so `bb plugin reload` picks up a
    // changed compact icon or logo file.
    const brandingAssetCandidate = await loadPluginBrandingAssets(
      row.id,
      manifest,
    );
    const settingsDescriptorsRef: { current: PluginSettingDescriptors } = {
      current: {},
    };
    const handle = createPluginApi({
      pluginId: row.id,
      logger: deps.logger,
      db: deps.db,
      dataDir: deps.dataDir,
      getSdk: () => boundSdk,
      getLoopbackBaseUrl: () => boundLoopbackBaseUrl,
      publishSignal: (channel, payload) => {
        deps.hub.notifyPluginSignal(row.id, channel, payload);
      },
      reportNeedsConfiguration: (message) => {
        reportNeedsConfiguration(row.id, message);
      },
      isAgentToolNameTaken: (name) => findAgentToolOwner(name, row.id),
      reportAgentToolProblem: (message) => {
        reportAgentToolProblem(row.id, message);
      },
      requestInteraction: (args) => {
        if (!deps.pendingInteractions) {
          throw new Error("Plugin interactions are unavailable in this host");
        }
        if (disposingPluginIds.has(row.id)) {
          throw new Error(`plugin "${row.id}" is disposing`);
        }
        return deps.pendingInteractions.requestPluginInteraction({
          ...args,
          pluginId: row.id,
        });
      },
      ensureSharedPortTunnel: (hostId) => {
        if (!deps.ensureSharedPortTunnel) {
          throw new Error("host shared-port control plane is unavailable");
        }
        return deps.ensureSharedPortTunnel(hostId);
      },
      validateSharedPortDeclaration: (hostId, ports) => {
        if (!deps.sharedPorts) {
          throw new Error("host shared-port control plane is unavailable");
        }
        return deps.sharedPorts.validateSharedPortDeclaration(hostId, ports);
      },
      declareSharedPorts: (hostId, ports) => {
        if (!deps.sharedPorts) {
          throw new Error("host shared-port control plane is unavailable");
        }
        deps.sharedPorts.declareSharedPorts({
          ownerId: row.id,
          hostId,
          ports,
        });
      },
      replaceDeclaredSharedPorts: (declarations) => {
        if (declarations.length > 0 && !deps.sharedPorts) {
          throw new Error("host shared-port control plane is unavailable");
        }
        deps.sharedPorts?.replaceDeclarationsForOwner(row.id, declarations);
      },
      callPluginHost: (args) => {
        if (hostArtifactCandidate === null) {
          throw new Error(
            `plugin "${row.id}" does not declare a bb.host entry`,
          );
        }
        if (!deps.callPluginHost) {
          throw new Error("host plugin transport is unavailable");
        }
        return deps.callPluginHost({
          pluginId: row.id,
          ...args,
          artifact: hostArtifactCandidate,
        });
      },
      registerProvider: (declaration) => {
        return registerPluginProvider({
          available: true,
          declaration,
          row,
          // Bound once the handle exists (below); registrations only flush
          // at activate(), after the factory — and therefore after
          // `bb.settings.define` — has run.
          settingsDescriptors: settingsDescriptorsRef.current,
        });
      },
      assertProviderRegistrable: (providerId) => {
        // A declaration is metadata; the implementation is the bridge this
        // plugin declares in its manifest (or, for pi, the bridge the daemon
        // bundles). A failed artifact build still stages the declaration so
        // the provider can be listed as unavailable; no declared bridge at all
        // remains a plugin authoring error.
        if (
          manifest.hostEntry !== undefined ||
          DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS.includes(providerId)
        ) {
          return;
        }
        throw new Error(
          `provider "${providerId}" has no bridge to run on: this plugin declares no "bb.host" entry in its manifest`,
        );
      },
      isProviderIdTaken: (providerId) => {
        if (!deps.providerRegistry) {
          throw new Error("the provider registry is unavailable in this host");
        }
        // This plugin's own previous-load registrations are ignored: on
        // reload they are disposed before the staged replacements flush, so
        // re-declaring the same id is not a collision.
        const existing = deps.providerRegistry.get(providerId);
        return existing !== null && existing.source.pluginId !== row.id;
      },
    });
    // `settings.define` mutates this record in place, so binding the
    // reference once is enough for later per-command reads.
    settingsDescriptorsRef.current = handle.settings.descriptors;
    // Mutable trees are edited between loads, so invalidate the previous
    // generation's URLs before importing (managed git:/npm: artifacts are
    // immutable after promotion and keep their cached modules).
    let rollbackGeneration: (() => void) | undefined;
    if (row.sourceKind === "path" || row.sourceKind === "builtin") {
      rollbackGeneration = bumpMutableRootGeneration(row.rootDir);
      ownedRootUrls.add(mutableRootUrl(mutableRootDir(row.rootDir)));
    }
    try {
      // Fresh instance per load: guarantees re-imports see current sources.
      const jiti = createJiti(import.meta.url, {
        moduleCache: false,
        ...(pluginSdkAlias === undefined ? {} : { alias: pluginSdkAlias }),
      });
      // Same jiti instance for source and prebuilt dist/server.js, so the
      // @get-bb/plugin-sdk resolution (and its legacy @bb/plugin-sdk alias)
      // applies identically to both.
      const mod = (await jiti.import(
        await resolveServerEntry(row, manifest),
      )) as {
        default?: unknown;
      };
      const factory = mod.default;
      if (typeof factory !== "function") {
        throw new Error(
          `server entry must default-export a factory (bb) => void, got ${typeof factory}`,
        );
      }
      await runFactoryTimeBoxed(
        factory as (api: BbPluginApi) => unknown,
        handle.api,
      );
    } catch (error) {
      // The candidate never commits, so its epoch and its CommonJS evictions
      // must not outlive it: the retained plugin keeps serving its own files.
      rollbackGeneration?.();
      for (const database of handle.databaseHandles.splice(0)) {
        try {
          database.close();
        } catch {
          // The load error below remains the actionable failure. Rollback
          // replaces the database only after all candidate handles close.
        }
      }
      handle.invalidate();
      let message = error instanceof Error ? error.message : String(error);
      // --ignore-scripts already prevents gyp builds at install; a .node
      // addon that slipped through dies here under Electron's ABI.
      if (/ERR_DLOPEN_FAILED|\.node/.test(message)) {
        message += " (native dependencies are not supported in BB plugins)";
      }
      if (previous !== undefined) {
        setStatus(row.id, "running", `reload failed: ${message}`);
      } else {
        setStatus(row.id, "error", message);
      }
      logger.warn(
        `plugin ${row.id} failed to load: ${statuses.get(row.id)?.detail}`,
      );
      return;
    }
    if (hostArtifactProblem !== null) {
      rollbackGeneration?.();
      try {
        replaceUnavailableProviderRegistrations(
          row,
          handle.listProviderDeclarations(),
          handle.settings.descriptors,
        );
      } catch (error) {
        hostArtifactProblem += `; failed to retain provider declaration: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      for (const database of handle.databaseHandles.splice(0)) {
        try {
          database.close();
        } catch {
          // The host-artifact failure remains the actionable load problem.
        }
      }
      handle.invalidate();
      setStatus(row.id, "error", hostArtifactProblem);
      logger.warn(`plugin ${row.id} failed to load: ${hostArtifactProblem}`);
      return;
    }
    const plugin: LoadedPlugin = {
      manifest,
      handle,
      services: handle.backgroundServices.map((record) => ({
        record,
        state: "stopped" as const,
        controller: null,
        current: null,
        restartTimer: null,
        consecutiveCrashes: 0,
        startedAt: 0,
        disposed: false,
      })),
    };
    if (previous !== undefined) {
      await disposePluginInstance(row.id, previous);
      if ((hungServices.get(row.id)?.size ?? 0) > 0) {
        loaded.delete(row.id);
        deps.sharedPorts?.clearDeclarationsForOwner(row.id);
        for (const database of handle.databaseHandles.splice(0)) {
          try {
            database.close();
          } catch {
            // The degraded status from the hung service is actionable.
          }
        }
        handle.invalidate();
        return;
      }
    }
    // One map replacement is the registration commit point. Until this line,
    // every dispatcher continues to resolve the complete previous handle.
    disposeUnavailableProviderRegistrations(row.id);
    loaded.set(row.id, plugin);
    appBundles.set(row.id, appBundleCandidate.snapshot);
    if (hostArtifactCandidate === null) hostArtifacts.delete(row.id);
    else hostArtifacts.set(row.id, hostArtifactCandidate);
    brandingAssets.set(row.id, brandingAssetCandidate);
    needsConfiguration.delete(row.id);
    agentToolProblems.delete(row.id);
    handle.activate();
    // Sync durable schedule rows to this load's registrations: upsert each
    // (computing next_run_at from its cron) and drop rows for names the
    // plugin no longer registers. Run history on kept rows survives.
    const now = Date.now();
    prunePluginSchedules(
      deps.db,
      row.id,
      handle.schedules.map((schedule) => schedule.name),
    );
    for (const schedule of handle.schedules) {
      upsertPluginSchedule(deps.db, {
        pluginId: row.id,
        name: schedule.name,
        cron: schedule.cron,
        nextRunAt: nextCronRunAt(schedule.cron, now),
      });
    }
    // Services start after the factory completes (design §4.8 bind phase).
    for (const service of plugin.services) {
      runService(row.id, service);
    }
    // A factory (or an immediately-crashing service) may have already
    // reported needs-configuration; do not paper over it with "running".
    // A dropped tool registration or a failed frontend rebuild keeps the
    // plugin running but rides along as the status detail.
    if (!needsConfiguration.has(row.id)) {
      const details = [
        agentToolProblems.get(row.id),
        appBundleCandidate.problem,
      ].filter((detail): detail is string => typeof detail === "string");
      setStatus(
        row.id,
        "running",
        details.length > 0 ? details.join("; ") : null,
      );
    }
    logger.info(`plugin ${row.id}@${manifest.version} loaded`);
  }

  async function disposePluginInstance(
    id: string,
    plugin: LoadedPlugin,
  ): Promise<void> {
    disposingPluginIds.add(id);
    try {
      const hostArtifact = hostArtifacts.get(id);
      if (hostArtifact !== undefined && deps.disposePluginHost) {
        try {
          await deps.disposePluginHost({
            pluginId: id,
            generation: hostArtifact.generation,
          });
        } catch (error) {
          logger.warn(
            `plugin ${id} host-worker cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      try {
        deps.pendingInteractions?.interruptPluginInteractions(id);
      } catch (error) {
        logger.warn(
          `plugin ${id} interaction cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // §3 order: services first (abort + bounded await), then dispose hooks,
      // then vended resources, then handle invalidation.
      await stopServices(id, plugin);
      // LIFO, each hook isolated: one bad hook must not skip the rest.
      for (const hook of [...plugin.handle.disposeHooks].reverse()) {
        try {
          await hook();
        } catch (error) {
          logger.warn(
            `plugin ${id} dispose hook failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // §3 step 3: let in-flight rpc/http/event handlers settle (bounded)
      // before their database handles close and their API handle goes stale.
      await drainInvocations(id);
      // Close host-vended database handles before invalidating: a stale handle
      // throws on use instead of writing to a database mid-reload.
      for (const database of plugin.handle.databaseHandles.splice(0)) {
        try {
          database.close();
        } catch (error) {
          logger.warn(
            `plugin ${id} database close failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      plugin.handle.invalidate();
      disposingPluginIds.delete(id);
    }
  }

  async function disposeOne(id: string): Promise<void> {
    disposeUnavailableProviderRegistrations(id);
    const plugin = loaded.get(id);
    if (!plugin) return;
    loaded.delete(id);
    await disposePluginInstance(id, plugin);
    hostArtifacts.delete(id);
    deps.sharedPorts?.clearDeclarationsForOwner(id);
  }

  async function disposeAll(): Promise<void> {
    const pluginIds = new Set([
      ...loaded.keys(),
      ...unavailableProviderRegistrations.keys(),
    ]);
    for (const id of pluginIds) {
      await withLifecycleLock(id, () => disposeOne(id));
    }
    // This runtime is going away, so hand its roots back. The resolve hook is
    // process-wide and is torn down once the last runtime releases its own.
    releaseMutableRoots(ownedRootUrls);
    ownedRootUrls.clear();
  }

  async function loadAll(): Promise<void> {
    const rows = listInstalledPlugins(deps.db).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      if (loaded.has(row.id)) continue;
      await withLifecycleLock(row.id, () => loadOne(row));
    }
  }

  /**
   * Resolve a wire request against the live tables. Handles the shared
   * unknown-plugin / not-running outcomes; `find` picks the record from a
   * running plugin's handle.
   */
  function wireLookup<T>(
    id: string,
    find: (plugin: LoadedPlugin) => T | undefined,
  ): PluginWireLookup<T> {
    const plugin = loaded.get(id);
    if (!plugin) {
      const row = getInstalledPlugin(deps.db, id);
      if (!row) return { outcome: "unknown-plugin" };
      const runtime = statuses.get(id);
      return {
        outcome: "not-running",
        status: runtime?.status ?? (row.enabled ? "error" : "disabled"),
        detail: runtime?.detail ?? (row.enabled ? "not loaded" : null),
      };
    }
    const value = find(plugin);
    if (value === undefined) return { outcome: "not-found" };
    return { outcome: "found", value };
  }

  function bindSdk(args: { baseUrl: string }): void {
    boundSdk = createNodeBbSdk({ baseUrl: args.baseUrl });
    boundLoopbackBaseUrl = args.baseUrl;
  }

  return {
    REGISTRATION_MUTATION_KEY,
    agentToolProblems,
    appBundles,
    hostArtifacts,
    bindSdk,
    buildThreadDto,
    builtinSourceWatchers,
    checkEngineRange,
    checkPluginSdkRange,
    disposeAll,
    disposeOne,
    emitThreadEvent,
    handlerStats,
    handleUncaughtException,
    hungServices,
    invokeWrapped,
    isBuiltinPluginId,
    identities,
    isPackagedBuiltinEntry,
    loadAll,
    loaded,
    loadOne,
    brandingAssets,
    setDevBuildProblem,
    setStatus,
    sourceKind,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    wireLookup,
    withArtifactLock,
    withLifecycleLock,
    withPluginOperationLock,
  };
}
