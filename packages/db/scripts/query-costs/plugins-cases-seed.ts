import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbConnection } from "../../src/connection.js";
import {
  createPluginArtifact,
  type CreatePluginArtifactInput,
  type PluginArtifactRow,
} from "../../src/data/plugin-artifacts.js";
import {
  replacePluginMarketplaceIcons,
  upsertPluginMarketplace,
} from "../../src/data/plugin-marketplaces.js";
import {
  recordPluginScheduleResult,
  upsertPluginSchedule,
} from "../../src/data/plugin-schedules.js";
import {
  createPluginStateSnapshot,
  type PluginStateSnapshotRow,
} from "../../src/data/plugin-state-snapshots.js";
import {
  setPluginKvValue,
  setPluginSettingsValues,
} from "../../src/data/plugin-storage.js";
import {
  markInstalledPluginRemoved,
  setInstalledPluginLastFailure,
  upsertInstalledPlugin,
  type PluginExactResolution,
  type PluginProvenance,
  type PluginSourceIntent,
} from "../../src/data/plugins.js";
import { createThread, getThread } from "../../src/data/threads.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { noopNotifier } from "../../src/notifier.js";
import { installedPlugins, pluginArtifacts } from "../../src/schema.js";
import { scaled } from "./case.js";

const DAY_MS = 86_400_000;
export const PLUGINS_DATA_DIR = "/Users/query-costs/.bb";
export const PLUGINS_CACHE_ROOT = `${PLUGINS_DATA_DIR}/plugins/cache`;
const NPM_REGISTRY = "https://registry.npmjs.org/";
const MARKETPLACES = ["bb-official", "community"] as const;
const GIT_REPOS = [
  "github.com/get-bb/bb-plugins",
  "github.com/acme/agent-tools",
  "github.com/acme/review-bots",
  "github.com/oss-dev/bb-extras",
  "github.com/oss-dev/linters",
] as const;
const BUILTIN_IDS = [
  "account-pool",
  "github-pr-status",
  "automations",
  "connect",
  "bb-account",
  "bb-ai",
  "git",
  "browser-automation",
] as const;
const SNAPSHOT_STATUSES: readonly PluginStateSnapshotRow["status"][] = [
  ...Array<PluginStateSnapshotRow["status"]>(70).fill("ready"),
  ...Array<PluginStateSnapshotRow["status"]>(15).fill("restored"),
  ...Array<PluginStateSnapshotRow["status"]>(10).fill("failed"),
  ...Array<PluginStateSnapshotRow["status"]>(3).fill("pending"),
  "rollback-pending",
  "restoring",
];

interface PluginSpec {
  id: string;
  provenance: PluginProvenance;
  sourceIntent: PluginSourceIntent;
  repo: string | null;
  artifactTarget: number;
}

export interface SeededNpmArtifact {
  id: string;
  pluginId: string;
  path: string;
  storageRoot: string;
  version: string;
  integrity: string;
}

export interface SeededGitArtifact {
  id: string;
  pluginId: string;
  path: string;
  commit: string;
  checkoutRoot: string;
}

export interface PluginsSeed {
  seededAt: number;
  threadIds: string[];
  pluginIds: string[];
  loadedPluginIds: string[];
  kvPluginId: string;
  kvPrefix: string;
  kvKey: string;
  biggestKvPluginId: string;
  settingsPluginId: string;
  marketplaceName: string;
  iconEntryId: string;
  catalogPluginId: string;
  npmPluginId: string;
  gitPluginId: string;
  legacyPlugin: { id: string; rootDir: string };
  removedPluginId: string;
  npmArtifact: SeededNpmArtifact;
  gitArtifact: SeededGitArtifact;
  busiestCheckoutRoot: string;
  readySnapshotId: string;
  pendingGitArtifactId: string;
  schedulePluginId: string;
  scheduleNames: string[];
  dueSchedule: { pluginId: string; name: string; nextRunAt: number };
  inFlightScheduleKeys: string[];
}

function hex(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function integrity(input: string): string {
  return `sha512-${createHash("sha512").update(input).digest("base64")}`;
}

function npmPackage(id: string): string {
  return `@bb-community/${id}`;
}

function npmStorageRoot(id: string, version: string): string {
  return `${PLUGINS_CACHE_ROOT}/npm/${npmPackage(id)}/${version}`;
}

function gitCheckoutRoot(repo: string, version: number): string {
  return `${PLUGINS_CACHE_ROOT}/git/${repo}/${hex(`${repo}:${version}`, 40)}`;
}

function versionOf(index: number): string {
  return `1.${Math.floor(index / 10)}.${index % 10}`;
}

function pluginSpecs(scale: number): PluginSpec[] {
  const specs: PluginSpec[] = BUILTIN_IDS.map((id) => ({
    id,
    provenance: { kind: "builtin" },
    sourceIntent: { kind: "builtin", name: id },
    repo: null,
    artifactTarget: 0,
  }));
  const npmCount = scaled(50, scale);
  for (let index = 0; index < npmCount; index += 1) {
    const id = `community-plugin-${index}`;
    specs.push({
      id,
      provenance: {
        kind: "catalog",
        marketplace: MARKETPLACES[index % 3 === 2 ? 1 : 0],
        entryId: id,
      },
      sourceIntent: {
        kind: "npm",
        packageName: npmPackage(id),
        registry: NPM_REGISTRY,
        requestedSpec: index % 4 === 0 ? "^1.0.0" : "latest",
        specKind: index % 4 === 0 ? "range" : "default",
      },
      repo: null,
      artifactTarget: index < 3 ? scaled(150, scale) : 0,
    });
  }
  const gitCount = scaled(25, scale);
  for (let index = 0; index < gitCount; index += 1) {
    const repo = GIT_REPOS[index % GIT_REPOS.length];
    const id = `git-plugin-${index}`;
    specs.push({
      id,
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "git",
        url: `https://${repo}.git`,
        subdirectory: `plugins/${id}`,
        selector:
          index % 3 === 0
            ? {
                kind: "range",
                range: "^2.0.0",
                tagPrefix: `${id}@`,
                resolvedTag: `${id}@2.4.1`,
              }
            : { kind: "ref", ref: "main", refKind: "branch" },
      },
      repo,
      artifactTarget: index < 2 ? scaled(100, scale) : 0,
    });
  }
  const pathCount = scaled(100, scale) - specs.length;
  for (let index = 0; index < pathCount; index += 1) {
    const id = `local-plugin-${index}`;
    specs.push({
      id,
      provenance: { kind: "direct" },
      sourceIntent: {
        kind: "path",
        canonicalPath: `/Users/query-costs/code/plugins/${id}`,
      },
      repo: null,
      artifactTarget: 0,
    });
  }
  return specs;
}

function distributeArtifacts(specs: PluginSpec[], total: number): void {
  const managed = specs.filter(
    (spec) =>
      spec.sourceIntent.kind === "npm" || spec.sourceIntent.kind === "git",
  );
  let remaining =
    total - managed.reduce((sum, spec) => sum + spec.artifactTarget, 0);
  const tail = managed.filter((spec) => spec.artifactTarget === 0);
  for (const spec of tail) spec.artifactTarget = 1;
  remaining -= tail.length;
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    const spec = tail[index % tail.length];
    if (spec === undefined) break;
    spec.artifactTarget += 1;
  }
}

function artifactInput(
  spec: PluginSpec,
  version: number,
  pending: boolean,
): CreatePluginArtifactInput {
  const id = `artifact-${spec.id}-${version}`;
  const base = {
    id,
    pluginId: spec.id,
    contentHash: pending ? null : hex(`content:${id}`, 64),
    validationResult: pending ? ("pending" as const) : ("valid" as const),
    validatedAt: pending ? null : Date.now(),
  };
  if (spec.sourceIntent.kind === "npm") {
    const semver = versionOf(version);
    return {
      ...base,
      sourceKind: "npm",
      path: `${npmStorageRoot(spec.id, semver)}/node_modules/${npmPackage(spec.id)}`,
      npmResolvedVersion: semver,
      gitResolvedCommit: null,
      gitCheckoutRoot: null,
      integrity: integrity(id),
    };
  }
  if (spec.repo === null) throw new Error(`Expected a repo for ${spec.id}`);
  const checkoutRoot = gitCheckoutRoot(spec.repo, version);
  return {
    ...base,
    sourceKind: "git",
    path: `${checkoutRoot}/plugins/${spec.id}`,
    npmResolvedVersion: null,
    gitResolvedCommit: hex(`${spec.repo}:${version}`, 40),
    gitCheckoutRoot: checkoutRoot,
    integrity: null,
  };
}

function exactResolution(
  spec: PluginSpec,
  active: PluginArtifactRow | undefined,
): PluginExactResolution {
  if (spec.sourceIntent.kind === "npm") {
    if (active?.npmResolvedVersion == null || active.integrity === null) {
      throw new Error(`Expected an npm artifact for ${spec.id}`);
    }
    return {
      kind: "npm",
      version: active.npmResolvedVersion,
      integrity: active.integrity,
    };
  }
  if (spec.sourceIntent.kind === "git") {
    if (active?.gitResolvedCommit == null) {
      throw new Error(`Expected a git artifact for ${spec.id}`);
    }
    return { kind: "git", commit: active.gitResolvedCommit };
  }
  return { kind: spec.sourceIntent.kind };
}

function rootDirOf(spec: PluginSpec): string {
  if (spec.sourceIntent.kind === "path") return spec.sourceIntent.canonicalPath;
  return `/Applications/bb.app/Contents/Resources/plugins/${spec.id}`;
}

function seedArtifacts(
  db: DbConnection,
  specs: PluginSpec[],
  seededAt: number,
): Map<string, PluginArtifactRow[]> {
  const backdate = db.$client.prepare(
    "UPDATE plugin_artifacts SET created_at = ?, updated_at = ?, validated_at = CASE WHEN validated_at IS NULL THEN NULL ELSE ? END WHERE id = ?",
  );
  const byPlugin = new Map<string, PluginArtifactRow[]>();
  for (const spec of specs) {
    if (spec.artifactTarget === 0) continue;
    const rows: PluginArtifactRow[] = [];
    for (let version = 0; version < spec.artifactTarget; version += 1) {
      const pending =
        spec.sourceIntent.kind === "git" && version === spec.artifactTarget - 2;
      const row = createPluginArtifact(
        db,
        artifactInput(spec, version, pending),
      );
      const age = (spec.artifactTarget - version) * 2 * DAY_MS;
      const at = seededAt - age;
      backdate.run(at, at, at, row.id);
      rows.push({ ...row, createdAt: at, updatedAt: at });
    }
    byPlugin.set(spec.id, rows);
  }
  return byPlugin;
}

function seedPlugins(
  db: DbConnection,
  specs: PluginSpec[],
  artifacts: Map<string, PluginArtifactRow[]>,
  seededAt: number,
): void {
  for (const [index, spec] of specs.entries()) {
    const active = artifacts.get(spec.id)?.at(-1);
    upsertInstalledPlugin(db, {
      id: spec.id,
      source:
        spec.sourceIntent.kind === "npm"
          ? spec.sourceIntent.packageName
          : spec.sourceIntent.kind === "git"
            ? spec.sourceIntent.url
            : rootDirOf(spec),
      provenance: spec.provenance,
      sourceIntent: spec.sourceIntent,
      exactResolution: exactResolution(spec, active),
      updateState: {
        lastCheckAt: index % 5 === 0 ? null : seededAt - DAY_MS,
        availableCompatibleVersion: index % 7 === 0 ? "9.9.9" : null,
        newestIncompatibleVersion: index % 11 === 0 ? "10.0.0" : null,
        statusDetail: null,
      },
      activeArtifactId: active?.id ?? null,
      rootDir: active?.path ?? rootDirOf(spec),
      version: active?.npmResolvedVersion ?? "1.0.0",
      enabled: index % 9 !== 4,
      enabledFollowsDefault: spec.provenance.kind === "builtin",
    });
    if (index % 13 === 6) {
      setInstalledPluginLastFailure(db, spec.id, {
        version: "1.0.0",
        label: "activation",
        detail: "Plugin failed to activate: TypeError: x is not a function",
        at: seededAt - DAY_MS,
      });
    }
  }
}

function seedSnapshots(
  db: DbConnection,
  artifacts: Map<string, PluginArtifactRow[]>,
  total: number,
  seededAt: number,
): string {
  const transitions: Array<{
    pluginId: string;
    from: PluginArtifactRow;
    to: PluginArtifactRow;
  }> = [];
  for (const [pluginId, rows] of artifacts) {
    for (let index = 1; index < rows.length; index += 1) {
      const from = rows[index - 1];
      const to = rows[index];
      if (from !== undefined && to !== undefined) {
        transitions.push({ pluginId, from, to });
      }
    }
  }
  let readySnapshotId: string | null = null;
  for (let index = 0; index < total; index += 1) {
    const transition = transitions[index % transitions.length];
    if (transition === undefined) throw new Error("Expected transitions");
    const status =
      SNAPSHOT_STATUSES[index % SNAPSHOT_STATUSES.length] ?? "ready";
    const id = `snapshot-${index}`;
    const createdAt = transition.to.createdAt + (index % 5) * 60_000;
    const snapshotPath = `${PLUGINS_DATA_DIR}/plugins/snapshots/${id}`;
    const rollback = status === "rollback-pending" || status === "restoring";
    createPluginStateSnapshot(db, {
      id,
      pluginId: transition.pluginId,
      fromArtifactId: transition.from.id,
      toArtifactId: transition.to.id,
      snapshotPath,
      databasePath: `${snapshotPath}/storage.sqlite`,
      statePath: `${snapshotPath}/state.json`,
      secretsPath: index % 3 === 0 ? `${snapshotPath}/secrets.json` : null,
      registrationPath: `${snapshotPath}/registration.json`,
      status,
      rollbackCandidateVersion: rollback ? "1.2.3" : null,
      rollbackCandidateLabel: rollback ? "previous version" : null,
      rollbackSourceFingerprint: rollback ? hex(id, 64) : null,
      rollbackBbVersion: rollback ? "0.80.0" : null,
      rollbackSdkVersion: rollback ? "0.40.0" : null,
      rollbackDetail: rollback ? "Update failed to activate" : null,
      createdAt,
      retainedUntil: createdAt + 30 * DAY_MS,
      updatedAt: createdAt,
    });
    if (status === "ready" && createdAt + 30 * DAY_MS > seededAt) {
      readySnapshotId = id;
    }
  }
  if (readySnapshotId === null) throw new Error("Expected a ready snapshot");
  return readySnapshotId;
}

function seedSchedules(
  db: DbConnection,
  pluginIds: string[],
  total: number,
  seededAt: number,
): {
  names: string[];
  due: PluginsSeed["dueSchedule"];
  inFlight: string[];
} {
  const names: string[] = [];
  let due: PluginsSeed["dueSchedule"] | null = null;
  const inFlight: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const pluginId =
      index % 5 < 3
        ? "automations"
        : (pluginIds[index % pluginIds.length] ?? "automations");
    const name = `schedule-${index}`;
    const nextRunAt =
      index % 2 === 0
        ? seededAt - (index + 1) * 60_000
        : seededAt + (index + 1) * 3_600_000;
    upsertPluginSchedule(db, {
      pluginId,
      name,
      cron: index % 3 === 0 ? "*/5 * * * *" : "0 9 * * 1-5",
      nextRunAt,
    });
    if (index % 4 === 1) {
      recordPluginScheduleResult(db, {
        pluginId,
        name,
        status: index % 8 === 1 ? "error" : "ok",
        error: index % 8 === 1 ? "Request timed out" : null,
        now: seededAt - DAY_MS,
      });
    }
    if (pluginId === "automations") names.push(name);
    if (index % 2 === 0 && pluginId === "automations") {
      if (inFlight.length < 2) inFlight.push(`${pluginId}/${name}`);
      else due = { pluginId, name, nextRunAt };
    }
  }
  if (due === null) throw new Error("Expected a due schedule");
  return { names, due, inFlight };
}

function seedThreads(
  db: DbConnection,
  fixture: HistoryFixture,
  count: number,
): string[] {
  const thread = getThread(db, fixture.threadId);
  if (thread === null) {
    throw new Error("Expected the history thread");
  }
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(
      createThread(db, noopNotifier, {
        projectId: fixture.projectId,
        environmentId: fixture.environmentId,
        providerId: thread.providerId,
        title: `Plugin thread ${index}`,
        status: "idle",
        ...(index % 10 === 0 ? { originPluginId: "automations" } : {}),
      }).id,
    );
  }
  return ids;
}

function jsonValue(size: number, label: string): string {
  return JSON.stringify({ label, payload: "x".repeat(size) });
}

function seedKv(
  db: DbConnection,
  threadIds: string[],
  otherPluginIds: string[],
  scale: number,
  seededAt: number,
): void {
  setPluginKvValue(
    db,
    "account-pool",
    "accounts",
    jsonValue(4_000, "accounts"),
  );
  setPluginKvValue(db, "account-pool", "config", jsonValue(400, "config"));
  setPluginKvValue(db, "account-pool", "routing.codex", "true");
  setPluginKvValue(db, "account-pool", "routing.claude", "true");
  for (const [index, threadId] of threadIds.entries()) {
    setPluginKvValue(
      db,
      "account-pool",
      `routed:${threadId}`,
      JSON.stringify({ accountId: `acct-${index % 6}`, at: seededAt }),
    );
    if (index % 4 === 0) {
      setPluginKvValue(db, "account-pool", `bypass:${threadId}`, "true");
    }
    if (index % 4 === 1) {
      setPluginKvValue(
        db,
        "account-pool",
        `retry-route:${threadId}`,
        '"provider-a"',
      );
    }
    setPluginKvValue(
      db,
      "github-pr-status",
      `pr:${threadId}`,
      jsonValue(300, `pr-${index}`),
    );
    setPluginKvValue(
      db,
      "github-pr-status",
      `checks:${threadId}`,
      jsonValue(600, `checks-${index}`),
    );
  }
  const automationRuns = scaled(600, scale);
  for (let index = 0; index < automationRuns; index += 1) {
    setPluginKvValue(
      db,
      "automations",
      `run:${String(index).padStart(6, "0")}`,
      jsonValue(200, `run-${index}`),
    );
  }
  setPluginKvValue(db, "connect", "shares", jsonValue(20_000, "shares"));
  const grants = scaled(200, scale);
  for (let index = 0; index < grants; index += 1) {
    setPluginKvValue(
      db,
      "connect",
      `grant:host-${index}`,
      JSON.stringify({ intent: "allow" }),
    );
  }
  const tail = scaled(700, scale);
  for (let index = 0; index < tail; index += 1) {
    const pluginId = otherPluginIds[index % otherPluginIds.length];
    if (pluginId === undefined) break;
    setPluginKvValue(db, pluginId, `state.${index}`, jsonValue(120, "state"));
  }
}

function seedSettings(db: DbConnection, pluginIds: string[]): void {
  for (const [index, pluginId] of pluginIds.entries()) {
    const values: Record<string, string> = {};
    const keyCount = 3 + (index % 6);
    for (let key = 0; key < keyCount; key += 1) {
      values[`setting${key}`] = JSON.stringify(
        key === 0 ? "enabled" : `value-${index}-${key}`,
      );
    }
    setPluginSettingsValues(db, pluginId, values);
  }
}

function seedMarketplaces(
  db: DbConnection,
  specs: PluginSpec[],
  iconsPerMarketplace: number,
  seededAt: number,
): string {
  let firstEntryId: string | null = null;
  for (const [marketplaceIndex, name] of MARKETPLACES.entries()) {
    const entries = Array.from({ length: iconsPerMarketplace }, (_, index) => {
      const spec = specs[index];
      return spec?.provenance.kind === "catalog" &&
        spec.provenance.marketplace === name
        ? spec.id
        : `${name}-entry-${index}`;
    });
    upsertPluginMarketplace(db, {
      name,
      sourceKind: marketplaceIndex === 0 ? "https" : "git",
      manifestUrl:
        marketplaceIndex === 0
          ? "https://getbb.app/marketplace.json"
          : "https://github.com/get-bb/community-plugins.git",
      sourceGitRef: marketplaceIndex === 0 ? null : "main",
      sourceGitSubdirectory: null,
      sourceGitCommit: marketplaceIndex === 0 ? null : hex(name, 40),
      manifestJson: JSON.stringify({
        name,
        plugins: entries.map((entryId) => ({
          id: entryId,
          description: `The ${entryId} plugin adds tools and panels to bb.`,
          source: { kind: "npm", package: npmPackage(entryId) },
          icon: `https://getbb.app/icons/${entryId}.png`,
        })),
      }),
      statsJson: JSON.stringify(
        Object.fromEntries(entries.map((entryId, index) => [entryId, index])),
      ),
      etag: `"${hex(`etag:${name}`, 16)}"`,
      lastModified: new Date(seededAt).toUTCString(),
      lastSuccessfulRefreshAt: seededAt - 3_600_000,
      lastAttemptedRefreshAt: seededAt - 3_600_000,
      lastError: null,
    });
    replacePluginMarketplaceIcons(
      db,
      name,
      entries.map((entryId) => ({
        marketplaceName: name,
        entryId,
        sourceUrl: `https://getbb.app/icons/${entryId}.png`,
        contentType: "image/png",
        etag: `"${hex(`icon:${entryId}`, 16)}"`,
        contentHash: hex(`icon:${entryId}`, 64),
        bytes: Buffer.alloc(4_096, entryId),
      })),
    );
    firstEntryId ??= entries.at(-1) ?? null;
  }
  if (firstEntryId === null) throw new Error("Expected marketplace icons");
  return firstEntryId;
}

function requireArtifact(
  artifacts: Map<string, PluginArtifactRow[]>,
  pluginId: string,
  index: number,
): PluginArtifactRow {
  const row = artifacts.get(pluginId)?.at(index);
  if (row === undefined) throw new Error(`Expected artifacts for ${pluginId}`);
  return row;
}

export function seedPluginsWorld(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): PluginsSeed {
  const seededAt = Date.now();
  const specs = pluginSpecs(scale);
  distributeArtifacts(specs, scaled(1_000, scale));
  return db.transaction(() => {
    const threadIds = seedThreads(db, fixture, scaled(1_000, scale));
    const artifacts = seedArtifacts(db, specs, seededAt);
    seedPlugins(db, specs, artifacts, seededAt);
    const pluginIds = specs.map((spec) => spec.id);
    const npmIds = specs
      .filter((spec) => spec.sourceIntent.kind === "npm")
      .map((spec) => spec.id);
    const removed = npmIds.slice(-scaled(5, scale));
    for (const id of removed) markInstalledPluginRemoved(db, id);
    const pathIds = specs
      .filter((spec) => spec.sourceIntent.kind === "path")
      .map((spec) => spec.id);
    const legacyIds = pathIds.slice(0, 3);
    for (const id of legacyIds) {
      db.update(installedPlugins)
        .set({ normalizationVersion: 0 })
        .where(eq(installedPlugins.id, id))
        .run();
    }
    const readySnapshotId = seedSnapshots(
      db,
      artifacts,
      scaled(2_000, scale),
      seededAt,
    );
    const schedules = seedSchedules(
      db,
      pluginIds.filter((id) => !removed.includes(id)),
      scaled(50, scale),
      seededAt,
    );
    seedKv(
      db,
      threadIds,
      pluginIds.filter(
        (id) =>
          ![
            "account-pool",
            "github-pr-status",
            "automations",
            "connect",
          ].includes(id),
      ),
      scale,
      seededAt,
    );
    seedSettings(db, pluginIds);
    const iconEntryId = seedMarketplaces(
      db,
      specs,
      scaled(400, scale),
      seededAt,
    );
    const npmPluginId = npmIds[0];
    const gitSpec = specs.find((spec) => spec.sourceIntent.kind === "git");
    const legacyId = legacyIds[0];
    const removedId = removed[0];
    if (
      npmPluginId === undefined ||
      gitSpec === undefined ||
      legacyId === undefined ||
      removedId === undefined
    ) {
      throw new Error("Expected npm, git, legacy and removed plugins");
    }
    const npmActive = requireArtifact(artifacts, npmPluginId, -1);
    const gitActive = requireArtifact(artifacts, gitSpec.id, -1);
    const sharedCheckoutRoot = requireArtifact(
      artifacts,
      gitSpec.id,
      0,
    ).gitCheckoutRoot;
    if (
      npmActive.npmResolvedVersion === null ||
      npmActive.integrity === null ||
      gitActive.gitResolvedCommit === null ||
      gitActive.gitCheckoutRoot === null ||
      sharedCheckoutRoot === null
    ) {
      throw new Error("Expected resolved artifacts");
    }
    const legacySpec = specs.find((spec) => spec.id === legacyId);
    if (legacySpec === undefined) throw new Error("Expected a legacy plugin");
    const pendingGit = db
      .select({ id: pluginArtifacts.id })
      .from(pluginArtifacts)
      .where(eq(pluginArtifacts.validationResult, "pending"))
      .get();
    if (pendingGit === undefined)
      throw new Error("Expected a pending artifact");
    return {
      seededAt,
      threadIds,
      pluginIds,
      loadedPluginIds: pluginIds.filter(
        (id, index) => !removed.includes(id) && index % 9 !== 4,
      ),
      kvPluginId: "account-pool",
      kvPrefix: "routed:",
      kvKey: `routed:${threadIds[0] ?? ""}`,
      biggestKvPluginId: "github-pr-status",
      settingsPluginId: pluginIds[5] ?? "bb-ai",
      marketplaceName: MARKETPLACES[0],
      iconEntryId,
      catalogPluginId: npmPluginId,
      npmPluginId,
      gitPluginId: gitSpec.id,
      legacyPlugin: { id: legacyId, rootDir: rootDirOf(legacySpec) },
      removedPluginId: removedId,
      npmArtifact: {
        id: npmActive.id,
        pluginId: npmPluginId,
        path: npmActive.path,
        storageRoot: npmStorageRoot(npmPluginId, npmActive.npmResolvedVersion),
        version: npmActive.npmResolvedVersion,
        integrity: npmActive.integrity,
      },
      gitArtifact: {
        id: gitActive.id,
        pluginId: gitSpec.id,
        path: gitActive.path,
        commit: gitActive.gitResolvedCommit,
        checkoutRoot: gitActive.gitCheckoutRoot,
      },
      busiestCheckoutRoot: sharedCheckoutRoot,
      readySnapshotId,
      schedulePluginId: "automations",
      scheduleNames: schedules.names,
      dueSchedule: schedules.due,
      inFlightScheduleKeys: schedules.inFlight,
      pendingGitArtifactId: pendingGit.id,
    };
  });
}
