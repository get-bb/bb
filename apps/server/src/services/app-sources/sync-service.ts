import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveApplicationPath,
  resolveAppsRootPath,
  resolveAppSourcePath,
  resolveAppSourceRepoPath,
} from "@bb/config/app-storage-paths";
import {
  applicationIdSchema,
  appSourceNameSchema,
  deriveAppSourceNameFromOrigin,
  type ApplicationId,
  type AppSourceName,
} from "@bb/domain";
import {
  appManifestSchema,
  type AppSourceAppState,
  type AppSourceConfig,
  type AppSourceStatus,
  type AppSourceSyncState,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import { directoryExists, isFsErrorWithCode } from "../lib/fs-errors.js";
import {
  appStorageTempDirName,
  appStorageTombstoneDirName,
} from "../apps/app-storage-staging.js";
import { GitCommandError, runGit } from "./git.js";
import {
  APP_SOURCE_PROVENANCE_FILE_NAME,
  computeAppFileHashes,
  fileHashesEqual,
  readAppSourceProvenance,
  writeAppSourceProvenance,
  type AppSourceProvenance,
} from "./provenance.js";
import {
  readAppSourceConfigs,
  readAppSourceSyncState,
  writeAppSourceConfigs,
  writeAppSourceSyncState,
} from "./store.js";

export interface AppSourceSyncServiceDeps {
  dataDir: string;
  logger: ServerLogger;
}

export interface AddAppSourceArgs {
  origin: string;
  name?: AppSourceName;
  ref?: string;
}

export interface SyncAppSourceArgs {
  name: AppSourceName;
  force: boolean;
}

export interface AppSourceSyncOutcome {
  status: AppSourceStatus;
  /** True when any installed app's files changed (callers broadcast apps-changed). */
  changed: boolean;
}

export interface AppSourceRemoveOutcome {
  changed: boolean;
}

export interface AppSourceSyncService {
  list(): Promise<AppSourceStatus[]>;
  add(args: AddAppSourceArgs): Promise<AppSourceSyncOutcome>;
  sync(args: SyncAppSourceArgs): Promise<AppSourceSyncOutcome>;
  remove(args: { name: AppSourceName }): Promise<AppSourceRemoveOutcome>;
  detach(args: { applicationId: ApplicationId }): Promise<void>;
  /** Delete guard: managed apps must be detached or removed via their source. */
  isApplicationManaged(applicationId: ApplicationId): Promise<boolean>;
}

interface DiscoveredApp {
  applicationId: ApplicationId;
  checkoutPath: string;
}

interface CheckoutDiscovery {
  apps: Map<ApplicationId, DiscoveredApp>;
  invalid: AppSourceAppState[];
}

interface OwnedApp {
  appRootPath: string;
  provenance: AppSourceProvenance;
}

interface InFlightSync {
  force: boolean;
  promise: Promise<AppSourceSyncOutcome>;
}

const DATA_DIRECTORY_NAME = "data";
const GIT_DIRECTORY_NAME = ".git";

function nowIso(): string {
  return new Date().toISOString();
}

function sortAppStates(states: AppSourceAppState[]): AppSourceAppState[] {
  return [...states].sort((left, right) =>
    left.applicationId.localeCompare(right.applicationId),
  );
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export function createAppSourceSyncService(
  deps: AppSourceSyncServiceDeps,
): AppSourceSyncService {
  const inFlightSyncs = new Map<AppSourceName, InFlightSync>();

  async function requireConfig(name: AppSourceName): Promise<AppSourceConfig> {
    const config = (await readAppSourceConfigs(deps.dataDir)).find(
      (candidate) => candidate.name === name,
    );
    if (config === undefined) {
      throw new ApiError(404, "app_source_missing", `Unknown app source "${name}"`);
    }
    return config;
  }

  /**
   * Brings the source's local checkout to the target commit. The checkout is
   * a plain git dir with an `origin` remote; one shallow fetch of the
   * configured ref (or the remote HEAD) followed by a forced detached
   * checkout handles clones, updates, branch/tag refs, and commit pins alike.
   */
  async function ensureCheckout(config: AppSourceConfig): Promise<string> {
    const repoPath = resolveAppSourceRepoPath(deps.dataDir, config.name);
    let initialized = false;
    if (await directoryExists(repoPath)) {
      try {
        const remoteUrl = await runGit({
          args: ["remote", "get-url", "origin"],
          cwd: repoPath,
        });
        initialized = remoteUrl === config.origin;
      } catch {
        initialized = false;
      }
    }
    if (!initialized) {
      await rm(repoPath, { recursive: true, force: true });
      await mkdir(repoPath, { recursive: true });
      await runGit({ args: ["init", "--quiet"], cwd: repoPath });
      // `--` ends option parsing so an origin starting with `-` (also rejected
      // by the schema) can never be read as a flag.
      await runGit({
        args: ["remote", "add", "origin", "--", config.origin],
        cwd: repoPath,
      });
    }
    // `--` before the ref is critical: git scans the whole argv for options, so
    // without it a ref like `--upload-pack=<cmd>` would execute a command. The
    // schema also rejects option-like refs; this is defense in depth.
    await runGit({
      args: ["fetch", "--depth", "1", "origin", "--", config.ref ?? "HEAD"],
      cwd: repoPath,
    });
    await runGit({
      args: [
        "-c",
        "advice.detachedHead=false",
        "checkout",
        "--force",
        "FETCH_HEAD",
      ],
      cwd: repoPath,
    });
    await runGit({ args: ["clean", "-fdx"], cwd: repoPath });
    return runGit({ args: ["rev-parse", "HEAD"], cwd: repoPath });
  }

  async function discoverAppsInCheckout(
    repoPath: string,
  ): Promise<CheckoutDiscovery> {
    const apps = new Map<ApplicationId, DiscoveredApp>();
    const invalid: AppSourceAppState[] = [];
    const entries = await readdir(repoPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const checkoutPath = path.join(repoPath, entry.name);
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(
          path.join(checkoutPath, "manifest.json"),
          "utf8",
        );
      } catch (error) {
        if (isFsErrorWithCode(error, "ENOENT")) {
          continue; // Not an app directory (docs, assets, ...).
        }
        throw error;
      }

      const directoryId = applicationIdSchema.safeParse(entry.name);
      let manifestJson: unknown;
      try {
        manifestJson = JSON.parse(manifestRaw);
      } catch {
        manifestJson = null;
      }
      const manifest = appManifestSchema.safeParse(manifestJson);
      if (!manifest.success) {
        if (directoryId.success) {
          invalid.push({
            applicationId: directoryId.data,
            status: "invalid",
            error: "manifest.json failed validation",
          });
        } else {
          deps.logger.warn(
            { directory: entry.name, repoPath },
            "Skipping app-source directory with invalid manifest and id",
          );
        }
        continue;
      }
      const applicationId = manifest.data.id;
      if (apps.has(applicationId)) {
        invalid.push({
          applicationId,
          status: "invalid",
          error: `duplicate app id (also declared by "${apps.get(applicationId)?.checkoutPath.split(path.sep).at(-1)}")`,
        });
        continue;
      }
      apps.set(applicationId, { applicationId, checkoutPath });
    }
    return { apps, invalid };
  }

  async function scanOwnedApps(
    sourceName: AppSourceName,
  ): Promise<Map<ApplicationId, OwnedApp>> {
    const owned = new Map<ApplicationId, OwnedApp>();
    let entries;
    try {
      entries = await readdir(resolveAppsRootPath(deps.dataDir), {
        withFileTypes: true,
      });
    } catch (error) {
      if (isFsErrorWithCode(error, "ENOENT")) {
        return owned;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const parsed = applicationIdSchema.safeParse(entry.name);
      if (!parsed.success) {
        continue;
      }
      const appRootPath = resolveApplicationPath(deps.dataDir, parsed.data);
      const provenance = await readAppSourceProvenance(appRootPath);
      if (provenance !== null && provenance.sourceName === sourceName) {
        owned.set(parsed.data, { appRootPath, provenance });
      }
    }
    return owned;
  }

  /**
   * Copies one app out of the checkout, skipping symlinks (no path escapes),
   * a top-level data/ dir (runtime-owned), and any provenance marker in the
   * repo (a source must not forge ownership). Returns content hashes for the
   * new provenance snapshot.
   */
  async function copyAppFromCheckout(
    checkoutPath: string,
    targetPath: string,
  ): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};

    async function walk(sourceDir: string, targetDir: string): Promise<void> {
      await mkdir(targetDir, { recursive: true });
      const entries = await readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        const sourceEntryPath = path.join(sourceDir, entry.name);
        const relativePath = path
          .relative(checkoutPath, sourceEntryPath)
          .split(path.sep)
          .join("/");
        if (entry.isSymbolicLink()) {
          deps.logger.warn(
            { path: relativePath, checkoutPath },
            "Skipping symlink in app source checkout",
          );
          continue;
        }
        if (entry.isDirectory()) {
          if (
            relativePath === DATA_DIRECTORY_NAME ||
            entry.name === GIT_DIRECTORY_NAME
          ) {
            continue;
          }
          await walk(sourceEntryPath, path.join(targetDir, entry.name));
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (relativePath === APP_SOURCE_PROVENANCE_FILE_NAME) {
          continue;
        }
        const bytes = await readFile(sourceEntryPath);
        await writeFile(path.join(targetDir, entry.name), bytes);
        hashes[relativePath] = createHash("sha256")
          .update(bytes)
          .digest("hex");
      }
    }

    await walk(checkoutPath, targetPath);
    return hashes;
  }

  /**
   * Stages the app in a temp dir, then swaps it into place with renames so a
   * crash never leaves a half-written app dir. App data is untouched: it
   * lives outside the app folder.
   */
  async function materializeApp(args: {
    discovered: DiscoveredApp;
    commitSha: string;
    sourceName: AppSourceName;
  }): Promise<void> {
    const appsRootPath = resolveAppsRootPath(deps.dataDir);
    await mkdir(appsRootPath, { recursive: true });
    const appRootPath = resolveApplicationPath(
      deps.dataDir,
      args.discovered.applicationId,
    );
    const tempPath = path.join(
      appsRootPath,
      appStorageTempDirName(args.discovered.applicationId),
    );
    try {
      const fileHashes = await copyAppFromCheckout(
        args.discovered.checkoutPath,
        tempPath,
      );
      await writeAppSourceProvenance(tempPath, {
        sourceName: args.sourceName,
        commitSha: args.commitSha,
        syncedAt: nowIso(),
        files: fileHashes,
      });
      if (await directoryExists(appRootPath)) {
        const tombstonePath = path.join(
          appsRootPath,
          appStorageTombstoneDirName(args.discovered.applicationId),
        );
        await rename(appRootPath, tombstonePath);
        await rename(tempPath, appRootPath);
        await rm(tombstonePath, { recursive: true, force: true });
      } else {
        await rename(tempPath, appRootPath);
      }
    } catch (error) {
      await rm(tempPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async function removeManagedApp(appRootPath: string): Promise<void> {
    const tombstonePath = path.join(
      resolveAppsRootPath(deps.dataDir),
      appStorageTombstoneDirName(path.basename(appRootPath)),
    );
    await rename(appRootPath, tombstonePath);
    await rm(tombstonePath, { recursive: true, force: true });
  }

  async function syncDiscoveredApp(args: {
    config: AppSourceConfig;
    discovered: DiscoveredApp;
    commitSha: string;
    force: boolean;
  }): Promise<{ state: AppSourceAppState; changed: boolean }> {
    const { applicationId } = args.discovered;
    const appRootPath = resolveApplicationPath(deps.dataDir, applicationId);
    const installed = await directoryExists(appRootPath);
    if (!installed) {
      await materializeApp({
        discovered: args.discovered,
        commitSha: args.commitSha,
        sourceName: args.config.name,
      });
      return {
        state: { applicationId, status: "installed", error: null },
        changed: true,
      };
    }

    const provenance = await readAppSourceProvenance(appRootPath);
    if (provenance === null) {
      return {
        state: {
          applicationId,
          status: "conflict",
          error: "id is used by a locally managed app",
        },
        changed: false,
      };
    }
    if (provenance.sourceName !== args.config.name) {
      return {
        state: {
          applicationId,
          status: "conflict",
          error: `id is managed by app source "${provenance.sourceName}"`,
        },
        changed: false,
      };
    }

    const currentHashes = await computeAppFileHashes(appRootPath);
    const diverged = !fileHashesEqual(currentHashes, provenance.files);
    if (diverged && !args.force) {
      return {
        state: { applicationId, status: "modified", error: null },
        changed: false,
      };
    }

    if (!diverged && provenance.commitSha === args.commitSha) {
      return {
        state: { applicationId, status: "installed", error: null },
        changed: false,
      };
    }

    await materializeApp({
      discovered: args.discovered,
      commitSha: args.commitSha,
      sourceName: args.config.name,
    });
    const newProvenance = await readAppSourceProvenance(appRootPath);
    return {
      state: { applicationId, status: "installed", error: null },
      changed:
        newProvenance === null ||
        !fileHashesEqual(newProvenance.files, currentHashes),
    };
  }

  async function performSync(
    config: AppSourceConfig,
    force: boolean,
  ): Promise<AppSourceSyncOutcome> {
    const previousState = await readAppSourceSyncState(
      deps.dataDir,
      config.name,
    );
    const startedAt = nowIso();
    await writeAppSourceSyncState(deps.dataDir, config.name, {
      ...previousState,
      lastSyncStartedAt: startedAt,
    });

    let commitSha: string;
    let discovery: CheckoutDiscovery;
    try {
      commitSha = await ensureCheckout(config);
      discovery = await discoverAppsInCheckout(
        resolveAppSourceRepoPath(deps.dataDir, config.name),
      );
    } catch (error) {
      const failedState: AppSourceSyncState = {
        ...previousState,
        lastSyncStartedAt: startedAt,
        lastError:
          error instanceof GitCommandError
            ? error.message
            : `sync failed: ${errorDetail(error)}`,
      };
      await writeAppSourceSyncState(deps.dataDir, config.name, failedState);
      deps.logger.warn(
        { sourceName: config.name, error: failedState.lastError },
        "App source sync failed; keeping last-known-good apps",
      );
      return {
        status: buildStatus(config, failedState, false),
        changed: false,
      };
    }

    const ownedApps = await scanOwnedApps(config.name);
    const appStates: AppSourceAppState[] = [...discovery.invalid];
    let changed = false;

    for (const discovered of discovery.apps.values()) {
      try {
        const result = await syncDiscoveredApp({
          config,
          discovered,
          commitSha,
          force,
        });
        appStates.push(result.state);
        changed = changed || result.changed;
      } catch (error) {
        appStates.push({
          applicationId: discovered.applicationId,
          status: "invalid",
          error: `install failed: ${errorDetail(error)}`,
        });
      }
    }

    for (const [applicationId, owned] of ownedApps) {
      if (discovery.apps.has(applicationId)) {
        continue;
      }
      const diverged = !fileHashesEqual(
        await computeAppFileHashes(owned.appRootPath),
        owned.provenance.files,
      );
      if (diverged && !force) {
        // Local edits win over upstream deletion; the app stays installed
        // and frozen until the user detaches or force-syncs.
        appStates.push({
          applicationId,
          status: "modified",
          error: "removed upstream; local edits kept",
        });
        continue;
      }
      await removeManagedApp(owned.appRootPath);
      changed = true;
    }

    const state: AppSourceSyncState = {
      lastSyncStartedAt: startedAt,
      lastSyncedAt: nowIso(),
      lastCommitSha: commitSha,
      lastError: null,
      apps: sortAppStates(appStates),
    };
    await writeAppSourceSyncState(deps.dataDir, config.name, state);
    return { status: buildStatus(config, state, false), changed };
  }

  /**
   * `syncing` reflects another in-flight sync at build time. Outcomes built
   * by performSync itself pass `syncing: false`: by the time the caller sees
   * them, that sync has finished.
   */
  function buildStatus(
    config: AppSourceConfig,
    state: AppSourceSyncState,
    syncing: boolean,
  ): AppSourceStatus {
    // lastSyncStartedAt is internal-only and omitted from the public status.
    const { lastSyncStartedAt: _lastSyncStartedAt, ...publicState } = state;
    return {
      ...config,
      ...publicState,
      syncing,
    };
  }

  function deriveSourceName(origin: string): AppSourceName {
    try {
      return deriveAppSourceNameFromOrigin(origin);
    } catch {
      throw new ApiError(
        400,
        "invalid_request",
        "Could not derive a source name from the origin; pass a name explicitly",
      );
    }
  }

  async function runCoalescedSync(
    config: AppSourceConfig,
    force: boolean,
  ): Promise<AppSourceSyncOutcome> {
    // Re-read the map after each await so two parked callers can't both fall
    // through and start concurrent syncs on the same source. A plain sync does
    // not satisfy a force request (it skips diverged apps), so a force caller
    // loops until it either joins a force sync or finds the slot empty. The
    // segment from this get() to the set() below has no await, so the first
    // caller to reach it installs its sync atomically and the rest join it.
    while (true) {
      const inFlight = inFlightSyncs.get(config.name);
      if (inFlight === undefined) {
        break;
      }
      const outcome = await inFlight.promise;
      if (!force || inFlight.force) {
        return outcome;
      }
    }
    const promise = performSync(config, force).finally(() => {
      inFlightSyncs.delete(config.name);
    });
    inFlightSyncs.set(config.name, { force, promise });
    return promise;
  }

  return {
    async list(): Promise<AppSourceStatus[]> {
      const configs = await readAppSourceConfigs(deps.dataDir);
      return Promise.all(
        configs.map(async (config) =>
          buildStatus(
            config,
            await readAppSourceSyncState(deps.dataDir, config.name),
            inFlightSyncs.has(config.name),
          ),
        ),
      );
    },

    async add(args: AddAppSourceArgs): Promise<AppSourceSyncOutcome> {
      const origin = args.origin.trim();
      if (origin.length === 0) {
        throw new ApiError(400, "invalid_request", "Origin is required");
      }
      const name =
        args.name !== undefined
          ? appSourceNameSchema.parse(args.name)
          : deriveSourceName(origin);
      const configs = await readAppSourceConfigs(deps.dataDir);
      if (configs.some((config) => config.name === name)) {
        throw new ApiError(
          409,
          "app_source_exists",
          `an app source named "${name}" already exists`,
        );
      }
      if (configs.some((config) => config.origin === origin)) {
        throw new ApiError(
          409,
          "app_source_exists",
          `an app source for "${origin}" already exists`,
        );
      }
      const config: AppSourceConfig = {
        name,
        origin,
        ref: args.ref ?? null,
      };
      await writeAppSourceConfigs(deps.dataDir, [...configs, config]);
      // The initial sync runs inline so the caller immediately sees which apps
      // were installed (or why the source is unreachable); it writes the state
      // file on both success and failure (readAppSourceSyncState tolerates the
      // missing file until then). A failed first sync keeps the source
      // registered with lastError set.
      return runCoalescedSync(config, false);
    },

    async sync(args: SyncAppSourceArgs): Promise<AppSourceSyncOutcome> {
      const config = await requireConfig(args.name);
      return runCoalescedSync(config, args.force);
    },

    async remove(args: {
      name: AppSourceName;
    }): Promise<AppSourceRemoveOutcome> {
      const config = await requireConfig(args.name);
      const inFlight = inFlightSyncs.get(config.name);
      if (inFlight !== undefined) {
        await inFlight.promise.catch(() => undefined);
      }
      const ownedApps = await scanOwnedApps(config.name);
      for (const owned of ownedApps.values()) {
        // App code goes; app data stays in the app-data root so re-adding
        // the source restores state. Data is removed only by an explicit
        // app delete.
        await removeManagedApp(owned.appRootPath);
      }
      const remaining = (await readAppSourceConfigs(deps.dataDir)).filter(
        (candidate) => candidate.name !== config.name,
      );
      await writeAppSourceConfigs(deps.dataDir, remaining);
      await rm(resolveAppSourcePath(deps.dataDir, config.name), {
        recursive: true,
        force: true,
      });
      return { changed: ownedApps.size > 0 };
    },

    async detach(args: { applicationId: ApplicationId }): Promise<void> {
      const appRootPath = resolveApplicationPath(
        deps.dataDir,
        args.applicationId,
      );
      if (!(await directoryExists(appRootPath))) {
        throw new ApiError(404, "app_missing", "App not found");
      }
      const provenance = await readAppSourceProvenance(appRootPath);
      if (provenance === null) {
        throw new ApiError(
          409,
          "app_not_managed",
          "App is not managed by an app source",
        );
      }
      await rm(path.join(appRootPath, APP_SOURCE_PROVENANCE_FILE_NAME), {
        force: true,
      });
      const state = await readAppSourceSyncState(
        deps.dataDir,
        provenance.sourceName,
      );
      await writeAppSourceSyncState(deps.dataDir, provenance.sourceName, {
        ...state,
        apps: sortAppStates([
          ...state.apps.filter(
            (app) => app.applicationId !== args.applicationId,
          ),
          {
            applicationId: args.applicationId,
            status: "conflict",
            error: "detached; now locally managed",
          },
        ]),
      });
    },

    async isApplicationManaged(
      applicationId: ApplicationId,
    ): Promise<boolean> {
      return (
        (await readAppSourceProvenance(
          resolveApplicationPath(deps.dataDir, applicationId),
        )) !== null
      );
    },
  };
}
