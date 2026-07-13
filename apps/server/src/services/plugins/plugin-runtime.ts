import type { FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createJiti } from "jiti";
import semver from "semver";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION, type Thread } from "@bb/domain";
import { buildPluginApp } from "@bb/plugin-build";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk";
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
  loadPluginLogos,
  parsePluginAppBundleMeta,
  readPluginAppBundleMeta,
  validatePluginArtifactMeta,
  type PluginAppBundleSnapshot,
  type PluginLogoSet,
} from "./app-bundle.js";
import { parsePluginSource } from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
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
  PluginWireLookup,
  ServiceRuntime,
} from "./plugin-service-internal.js";

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_SERVICE_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SERVICE_RESTART_BASE_MS = 1_000;
const SERVICE_RESTART_MAX_MS = 60_000;
/** A crash after this much healthy runtime resets the backoff sequence. */
const SERVICE_HEALTHY_RESET_MS = 5 * 60_000;
const CONNECT_BUILTIN_PLUGIN_NAME = "connect";

export interface PluginRuntimeContext {
  deps: PluginServiceDeps;
  nextCronRunAt: (cron: string, now: number) => number;
  settledWithin: (
    promise: Promise<unknown>,
    timeoutMs: number,
  ) => Promise<boolean>;
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
  // Per-plugin lifecycle mutex: every load/dispose mutation for one plugin
  // runs strictly serialized. disposeOne removes the `loaded` entry before
  // stopServices finishes, so without this a concurrent reload/enable/
  // install could enter loadOne mid-dispose (no loaded entry, no hung
  // marker yet) and double-start the plugin's services.
  const lifecycleChains = new Map<string, Promise<void>>();
  const artifactChains = new Map<string, Promise<void>>();
  const pluginOperationChains = new Map<string, Promise<void>>();
  const REGISTRATION_MUTATION_KEY = "plugin-registration-mutations";
  const disposingPluginIds = new Set<string>();
  const builtinSourceWatchers: FSWatcher[] = [];

  function withLifecycleLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = lifecycleChains.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    lifecycleChains.set(id, tail);
    void tail.then(() => {
      if (lifecycleChains.get(id) === tail) lifecycleChains.delete(id);
    });
    return result;
  }

  function withArtifactLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = artifactChains.get(key) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    artifactChains.set(key, tail);
    void tail.then(() => {
      if (artifactChains.get(key) === tail) artifactChains.delete(key);
    });
    return result;
  }

  function withPluginOperationLock<T>(
    id: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = pluginOperationChains.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    pluginOperationChains.set(id, tail);
    void tail.then(() => {
      if (pluginOperationChains.get(id) === tail) {
        pluginOperationChains.delete(id);
      }
    });
    return result;
  }
  const statuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
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
  // Logo snapshots (light + optional dark variant), refreshed alongside
  // appBundles on every load. Entries are only servable (and only advertised
  // via logoUrl/logoDarkUrl) while the plugin is in `loaded` — same honest
  // gate as getAppAsset.
  const logos = new Map<string, PluginLogoSet>();
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

  function setStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null = null,
  ): void {
    statuses.set(id, { status, detail });
    for (const listener of statusListeners.get(id) ?? []) {
      listener(status, detail);
    }
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

  /** Start (or restart) one background service instance. */
  function runService(id: string, service: ServiceRuntime): void {
    const controller = new AbortController();
    service.controller = controller;
    service.state = "running";
    service.startedAt = Date.now();
    // The async wrapper normalizes sync throws from start() into rejections.
    const current = (async () => {
      await service.record.start(controller.signal);
    })();
    service.current = current;
    current.then(
      () => onServiceSettled(id, service, { crashed: false }),
      (error: unknown) =>
        onServiceSettled(id, service, { crashed: true, error }),
    );
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
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
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
      return { ok: true, value: await run() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.errorCount += 1;
      logger.warn(`[plugin:${id}] ${label} failed: ${message}`);
      if (statuses.get(id)?.status === "running") {
        setStatus(id, "running", `${label} failed: ${message}`);
      }
      return { ok: false, error: message };
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
   * invocations so dispose does not close sqlite handles or invalidate the
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

  async function invokeThreadEventHandler<E extends PluginThreadEventName>(
    id: string,
    event: E,
    handler: (payload: PluginThreadEventPayloads[E]) => void | Promise<void>,
    payload: PluginThreadEventPayloads[E],
  ): Promise<void> {
    await invokeWrapped(id, `${event} handler`, () => handler(payload));
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
          void invokeThreadEventHandler(id, event, handler, payload);
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
    if (!semver.satisfies(PLUGIN_SDK_VERSION, manifest.bbPluginSdkRange)) {
      return `requires bb plugin SDK ${manifest.bbPluginSdkRange}, running SDK is ${PLUGIN_SDK_VERSION}`;
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

  function builtinName(row: InstalledPluginRow): string | null {
    return row.sourceKind === "builtin" ? row.sourceBuiltinName : null;
  }

  function isPackagedBuiltinAppEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
  }): boolean {
    return (
      args.kind === "builtin" &&
      args.manifest.appEntry === resolve(args.rootDir, "dist", "app.js")
    );
  }

  function isPackagedBuiltinServerEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
  }): boolean {
    return (
      args.kind === "builtin" &&
      args.manifest.serverEntry === resolve(args.rootDir, "dist", "server.js")
    );
  }

  async function packagedBuiltinArtifactProblem(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string | null> {
    const kind = sourceKind(row.source);
    if (
      !isPackagedBuiltinServerEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
      })
    ) {
      return null;
    }
    async function validate(
      artifact: "server" | "app",
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
    if (isPackagedBuiltinAppEntry({ kind, manifest, rootDir: row.rootDir })) {
      return validate("app");
    }
    return null;
  }

  function isBuiltinPluginId(id: string): boolean {
    const row = getInstalledPlugin(deps.db, id);
    return row?.sourceKind === "builtin";
  }

  function isBuiltinPluginLoadEnabled(name: string): boolean {
    if (name === CONNECT_BUILTIN_PLUGIN_NAME) {
      return deps.isConnectEnabled();
    }
    return true;
  }

  function experimentGateDisabledDetail(
    row: InstalledPluginRow,
  ): string | null {
    const name = builtinName(row);
    if (name === CONNECT_BUILTIN_PLUGIN_NAME) {
      return 'disabled by the "bb connect" experiment';
    }
    if (name === null) {
      return 'disabled by the "Plugins" experiment';
    }
    return null;
  }

  function shouldLoadRow(row: InstalledPluginRow): boolean {
    const name = builtinName(row);
    if (name !== null) return isBuiltinPluginLoadEnabled(name);
    return deps.isEnabled();
  }

  function shouldExposeLoadedPlugin(plugin: LoadedPlugin): boolean {
    if (plugin.builtinName !== null) {
      return isBuiltinPluginLoadEnabled(plugin.builtinName);
    }
    return deps.isEnabled();
  }

  function shouldExposePluginId(id: string): boolean {
    const plugin = loaded.get(id);
    if (plugin !== undefined) return shouldExposeLoadedPlugin(plugin);
    const row = getInstalledPlugin(deps.db, id);
    if (row === undefined) return deps.isEnabled();
    return shouldLoadRow(row);
  }

  function exposedLoadedEntries(): Array<[string, LoadedPlugin]> {
    return [...loaded.entries()].filter(([, plugin]) =>
      shouldExposeLoadedPlugin(plugin),
    );
  }

  /**
   * The backend entry to import for this load. Managed (git:/npm:) installs
   * prefer a fresh, SDK-major-compatible prebuilt `dist/server.js` (design
   * §3 loader amendment, §6 prebuilt distribution) so consumers never need
   * npm or node_modules; path installs ALWAYS load from source, so author
   * iteration via `bb plugin reload` sees edited files. A present-but-stale
   * or meta-less dist falls back to source with one warning.
   */
  async function resolveServerEntry(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string> {
    if (row.sourceKind === "path") return manifest.serverEntry;
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
    if (meta?.sdkMajor !== PLUGIN_SDK_MAJOR) {
      logger.warn(
        `plugin ${row.id}: ignoring prebuilt dist/server.js (built for SDK ${meta ? `major ${meta.sdkMajor}` : "unknown"}, running SDK major is ${PLUGIN_SDK_MAJOR}) — loading from source`,
      );
      return manifest.serverEntry;
    }
    return distJsPath;
  }

  /**
   * Refresh a plugin's frontend-bundle snapshot for this load (design §5.1).
   * Mutable path: and source-builtin trees are rebuilt when the recorded SDK
   * version differs from the running one. Managed git/npm artifacts are
   * immutable after promotion and are served exactly as validated;
   * incompatible metadata is surfaced without rewriting cached bytes.
   */
  async function refreshAppBundle(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string | null> {
    if (manifest.appEntry === undefined) {
      appBundles.set(row.id, {
        state: { hasApp: false, bundle: null },
        assets: null,
      });
      return null;
    }
    const kind = row.sourceKind;
    if (
      (kind === "path" || kind === "builtin") &&
      !isPackagedBuiltinAppEntry({ kind, manifest, rootDir: row.rootDir })
    ) {
      const meta = await readPluginAppBundleMeta(row.rootDir);
      if (meta?.sdkVersion !== PLUGIN_SDK_VERSION) {
        logger.info(
          `plugin ${row.id}: rebuilding frontend bundle (built with SDK ${meta?.sdkVersion ?? "unknown"}, running SDK is ${PLUGIN_SDK_VERSION})`,
        );
        try {
          await buildPluginApp(row.rootDir, deps.appVersion);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            `plugin ${row.id}: frontend bundle rebuild failed: ${message}`,
          );
          appBundles.set(row.id, {
            state: { hasApp: true, bundle: null },
            assets: null,
          });
          return `frontend bundle rebuild failed: ${message}`;
        }
      }
    }
    appBundles.set(row.id, await loadPluginAppBundle(row.id, row.rootDir));
    return null;
  }

  async function loadOne(row: InstalledPluginRow): Promise<void> {
    if (!row.enabled) {
      setStatus(row.id, "disabled");
      return;
    }
    if (loaded.has(row.id)) {
      // Idempotent load: enabling an already-running plugin (or any future
      // caller) must not orphan the previous instance — its services would
      // keep running and its sqlite handles would leak.
      await disposeOne(row.id);
    }
    const hung = hungServices.get(row.id);
    if (hung !== undefined && hung.size > 0) {
      // A previous instance's service never stopped; loading now would
      // double-start it (design §3: degraded rather than double-starting).
      setStatus(
        row.id,
        "degraded",
        `service ${[...hung].join(", ")} did not stop`,
      );
      return;
    }
    try {
      await stat(row.rootDir);
    } catch {
      setStatus(
        row.id,
        "missing",
        `plugin directory not found: ${row.rootDir} (reinstall)`,
      );
      return;
    }
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(row.rootDir);
    } catch (error) {
      setStatus(
        row.id,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const engineProblem =
      checkEngineRange(manifest) ?? checkPluginSdkRange(manifest);
    if (engineProblem) {
      setStatus(row.id, "incompatible", engineProblem);
      return;
    }
    const artifactProblem = await packagedBuiltinArtifactProblem(row, manifest);
    if (artifactProblem !== null) {
      setStatus(row.id, "incompatible", artifactProblem);
      return;
    }
    // Before the factory runs, so a backend load failure still leaves
    // current bundle info in the inventory (the frontend only imports
    // bundles of running plugins anyway).
    const appBundleProblem = await refreshAppBundle(row, manifest);
    // Logo refresh rides every load too, so `bb plugin reload` picks up a
    // changed/added/removed logo file (either variant).
    logos.set(row.id, await loadPluginLogos(row.id, row.rootDir, manifest));
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
    });
    // Fresh load: a plugin that was waiting on configuration gets to prove
    // itself again (its factory/services re-report if still unconfigured).
    needsConfiguration.delete(row.id);
    agentToolProblems.delete(row.id);
    try {
      // Fresh instance per load: guarantees re-imports see current sources.
      const jiti = createJiti(import.meta.url, { moduleCache: false });
      // Same jiti instance for source and prebuilt dist/server.js, so the
      // @bb/plugin-sdk resolution applies identically to both.
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
      for (const database of handle.sqliteHandles.splice(0)) {
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
      setStatus(row.id, "error", message);
      logger.warn(
        `plugin ${row.id} failed to load: ${statuses.get(row.id)?.detail}`,
      );
      return;
    }
    const loadedBuiltinName = builtinName(row);
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
      isBuiltin: loadedBuiltinName !== null,
      builtinName: loadedBuiltinName,
    };
    loaded.set(row.id, plugin);
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
      const details = [agentToolProblems.get(row.id), appBundleProblem].filter(
        (detail): detail is string => typeof detail === "string",
      );
      setStatus(
        row.id,
        "running",
        details.length > 0 ? details.join("; ") : null,
      );
    }
    logger.info(`plugin ${row.id}@${manifest.version} loaded`);
  }

  async function disposeOne(id: string): Promise<void> {
    const plugin = loaded.get(id);
    if (!plugin) return;
    loaded.delete(id);
    disposingPluginIds.add(id);
    try {
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
      // before their sqlite handles close and their API handle goes stale.
      await drainInvocations(id);
      // Close host-vended sqlite handles before invalidating: a stale handle
      // throws on use instead of writing to a database mid-reload.
      for (const database of plugin.handle.sqliteHandles.splice(0)) {
        try {
          database.close();
        } catch (error) {
          logger.warn(
            `plugin ${id} sqlite close failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      plugin.handle.invalidate();
      disposingPluginIds.delete(id);
    }
  }

  async function disposeAll(): Promise<void> {
    for (const id of [...loaded.keys()]) {
      await withLifecycleLock(id, () => disposeOne(id));
    }
  }

  function clearRuntimeState(id: string): void {
    statuses.delete(id);
    appBundles.delete(id);
    logos.delete(id);
    needsConfiguration.delete(id);
    agentToolProblems.delete(id);
  }

  async function unloadOneForExperimentGate(
    row: InstalledPluginRow,
  ): Promise<void> {
    await disposeOne(row.id);
    clearRuntimeState(row.id);
    if (row.enabled) {
      setStatus(row.id, "disabled", experimentGateDisabledDetail(row));
    } else {
      setStatus(row.id, "disabled");
    }
  }

  async function loadAll(): Promise<void> {
    const rows = listInstalledPlugins(deps.db).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      if (shouldLoadRow(row)) {
        if (loaded.has(row.id)) continue;
        await withLifecycleLock(row.id, () => loadOne(row));
      } else {
        await withLifecycleLock(row.id, () => unloadOneForExperimentGate(row));
      }
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
    if (!shouldExposePluginId(id)) {
      const row = getInstalledPlugin(deps.db, id);
      if (!row) return { outcome: "unknown-plugin" };
      const runtime = statuses.get(id);
      return {
        outcome: "not-running",
        status: runtime?.status ?? "disabled",
        detail: runtime?.detail ?? experimentGateDisabledDetail(row),
      };
    }
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
    bindSdk,
    buildThreadDto,
    builtinSourceWatchers,
    checkEngineRange,
    checkPluginSdkRange,
    clearRuntimeState,
    disposeAll,
    disposeOne,
    emitThreadEvent,
    experimentGateDisabledDetail,
    exposedLoadedEntries,
    handlerStats,
    hungServices,
    invokeWrapped,
    isBuiltinPluginId,
    isPackagedBuiltinAppEntry,
    loadAll,
    loaded,
    loadOne,
    logos,
    needsConfiguration,
    setStatus,
    shouldExposeLoadedPlugin,
    shouldExposePluginId,
    shouldLoadRow,
    sourceKind,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    unloadOneForExperimentGate,
    wireLookup,
    withArtifactLock,
    withLifecycleLock,
    withPluginOperationLock,
  };
}
