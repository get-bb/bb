import semver from "semver";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  getInstalledPlugin,
  listInstalledPlugins,
  listRecentPluginArtifacts,
  setInstalledPluginSourceClassification,
  setInstalledPluginUpdateState,
  type InstalledPluginRow,
  type PluginGitSelector,
} from "@bb/db";
import { gitSelectorForRow } from "./git-source-intent.js";
import {
  gitArtifactCacheDir,
  gitRangeSourceSpec,
  gitSemverTagVersion,
  parsePluginSource,
  runInstallCommand,
} from "./install-sources.js";
import { readPluginManifest } from "./manifest.js";
import {
  createNpmResolverRun,
  type NpmResolverRun,
  resolveGitRef,
  resolveGitUpdate,
  resolveNpmUpdate,
  selectNpmCandidate,
  type CompatibilityProblem,
  type GitCandidateProbe,
  type GitCandidateProbeResult,
  type NpmSourceIntentForResolution,
  type PluginResolvedUpdateVersion,
  type PluginUpdateResolution,
  type RangeUpgradeBasis,
} from "./update-resolver.js";
import { PluginActivationRolledBackError } from "./plugin-activation.js";
import type { SafeModeActivationRefusalArgs } from "./plugin-runtime.js";
import type { createPluginActivation } from "./plugin-activation.js";
import {
  createListedRegistryNpmResolverRun,
  type createManagedPluginArtifacts,
} from "./managed-plugin-artifacts.js";
import { MARKETPLACE_FETCH_TIMEOUT_MS } from "../plugin-catalog/marketplace-http.js";
import { removeUnusedPluginArtifacts } from "./plugin-artifact-gc.js";
import {
  SERVER_MOVE_FROZEN_RETRY_MS,
  isServerMoveFrozen,
} from "../server-move/freeze-state.js";
import {
  pluginResolvedVersionSchema,
  pluginUpdateCheckEntrySchema,
  type PluginSourceDetail,
  type PluginUpdateCheckEntry,
} from "@bb/server-contract";
import type {
  PluginApplyUpdateOutcome,
  PluginServiceDeps,
} from "./plugin-service-internal.js";

const PLUGIN_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

async function gitSubdirectoryMatches(args: {
  url: string;
  installedCommit: string;
  candidateCommit: string;
  subdirectory: string;
}): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), "bb-plugin-update-trees-"));
  try {
    await runInstallCommand("git", ["init", "--bare", "--quiet", directory]);
    await runInstallCommand("git", [
      "-C",
      directory,
      "fetch",
      "--quiet",
      "--no-tags",
      "--depth=1",
      "--filter=blob:none",
      "--",
      args.url,
      args.installedCommit,
      args.candidateCommit,
    ]);
    const trees = await Promise.all(
      [args.installedCommit, args.candidateCommit].map((commit) =>
        runInstallCommand("git", [
          "-C",
          directory,
          "rev-parse",
          "--verify",
          `${commit}:${args.subdirectory}`,
        ]),
      ),
    );
    return trees[0] === trees[1];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const persistedResolvedVersionSchema = pluginResolvedVersionSchema.extend({
  label: z.string().optional(),
});

export interface PluginApplyUpdateOptions {
  range?: string;
  expectedVersion?: string;
}

const persistedUpdateCheckEntrySchema = pluginUpdateCheckEntrySchema.extend({
  installed: persistedResolvedVersionSchema,
  candidate: persistedResolvedVersionSchema.optional(),
  blocked: z
    .object({
      version: z.string(),
      label: z.string().optional(),
      reasons: z.array(z.string()),
    })
    .optional(),
});

export function pluginVersionLabelForRow(
  row: Pick<InstalledPluginRow, "sourceKind">,
  version: string,
): string {
  return row.sourceKind === "git" ? version.slice(0, 7) : version;
}

export function parsePersistedUpdateEntry(
  row: InstalledPluginRow,
): PluginUpdateCheckEntry | null {
  if (row.updateStatusDetail === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(row.updateStatusDetail);
  } catch {
    return null;
  }
  const parsed = persistedUpdateCheckEntrySchema.safeParse(json);
  if (!parsed.success || parsed.data.id !== row.id) return null;
  const { installed, candidate, blocked, ...entry } = parsed.data;
  const labelled = <T extends { version: string; label?: string }>(
    value: T,
  ): T & { label: string } => ({
    ...value,
    label: value.label ?? pluginVersionLabelForRow(row, value.version),
  });
  return {
    ...entry,
    installed: labelled(installed),
    ...(candidate === undefined ? {} : { candidate: labelled(candidate) }),
    ...(blocked === undefined ? {} : { blocked: labelled(blocked) }),
  };
}
const UPDATE_CHECK_CONCURRENCY = 4;

function npmRunForRow(row: InstalledPluginRow): NpmResolverRun {
  const registry = row.provenance === "catalog" ? row.sourceNpmRegistry : null;
  return registry === null
    ? createNpmResolverRun({
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS),
          }),
      })
    : createListedRegistryNpmResolverRun(registry);
}

export interface PluginUpdates {
  checkForUpdates(id?: string): Promise<PluginUpdateCheckEntry[]>;
  startPeriodicUpdateChecks(): void;
  stopPeriodicUpdateChecks(): Promise<void>;
  listUpdateResults(): PluginUpdateCheckEntry[];
  getSource(id: string): Promise<PluginSourceDetail | undefined>;
  applyUpdate(
    id: string,
    options?: PluginApplyUpdateOptions,
  ): Promise<PluginApplyUpdateOutcome>;
}

interface PluginUpdatesContext {
  deps: PluginServiceDeps;
  registrationMutationKey: string;
  withLifecycleLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  withPluginOperationLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  notifyPluginsChanged: () => void;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
  npmIntentForRow: (row: InstalledPluginRow) => NpmSourceIntentForResolution;
  rangeUpgradeBasisForRow: (row: InstalledPluginRow) => RangeUpgradeBasis;
  managedArtifacts: Pick<
    ReturnType<typeof createManagedPluginArtifacts>,
    "applyNpmCandidate" | "stageGitCandidate"
  >;
  runArtifactGc: ReturnType<typeof createPluginActivation>["runArtifactGc"];
  safeModeActivationRefusal: (
    args: SafeModeActivationRefusalArgs,
  ) => string | null;
}

export function createPluginUpdates(
  context: PluginUpdatesContext,
): PluginUpdates {
  const {
    deps,
    registrationMutationKey: REGISTRATION_MUTATION_KEY,
    withLifecycleLock,
    withPluginOperationLock,
    notifyPluginsChanged,
    installedUpdateVersion,
    npmIntentForRow,
    rangeUpgradeBasisForRow,
    managedArtifacts: { applyNpmCandidate, stageGitCandidate },
    runArtifactGc,
    safeModeActivationRefusal,
  } = context;
  const now = deps.now ?? Date.now;
  const gitCandidateProbeCache = new Map<string, GitCandidateProbeResult>();

  function problemMessages(problems: CompatibilityProblem[]): string[] {
    return problems.map((problem) => problem.message);
  }

  function savedRangeForRow(row: InstalledPluginRow): string | null {
    if (row.sourceKind === "git") return row.sourceGitRange;
    if (row.sourceKind === "npm" && row.sourceNpmSpecKind === "range") {
      return row.sourceNpmRequestedSpec;
    }
    return null;
  }

  function rangeChangeProblem(
    row: InstalledPluginRow,
    range: string,
  ): string | null {
    if (semver.validRange(range) === null) {
      return `"${range}" is not a valid semver range`;
    }
    if (savedRangeForRow(row) === null) {
      return `plugin "${row.id}" does not follow a version range, so bb cannot change its range; remove and reinstall it with an npm range or a git semver range`;
    }
    return null;
  }

  function installedReleaseVersion(row: InstalledPluginRow): string | null {
    if (row.sourceKind === "npm") return row.npmResolvedVersion;
    if (row.sourceGitResolvedTag === null || row.sourceGitTagPrefix === null) {
      return null;
    }
    return gitSemverTagVersion(
      row.sourceGitResolvedTag,
      row.sourceGitTagPrefix,
    );
  }

  function candidateReleaseVersion(
    row: InstalledPluginRow,
    resolution: Extract<
      PluginUpdateResolution,
      { outcome: "update-available" }
    >,
  ): string | null {
    if (row.sourceKind === "npm") return resolution.candidate.version;
    if (
      resolution.candidateGitTag === undefined ||
      row.sourceGitTagPrefix === null
    ) {
      return null;
    }
    return gitSemverTagVersion(
      resolution.candidateGitTag,
      row.sourceGitTagPrefix,
    );
  }

  function reviewedReleaseLabel(
    row: InstalledPluginRow,
    version: string,
  ): string {
    const persisted = parsePersistedUpdateEntry(row);
    const reviewed = [
      persisted?.candidate,
      persisted?.rangeUpgrade?.candidate,
    ].find((candidate) => candidate?.version === version);
    return reviewed?.label ?? pluginVersionLabelForRow(row, version);
  }

  function checkEntryFromResolution(
    row: InstalledPluginRow,
    installed: PluginResolvedUpdateVersion,
    resolution: PluginUpdateResolution,
  ): PluginUpdateCheckEntry {
    const id = row.id;
    const savedRange = savedRangeForRow(row);
    const dev = resolution.devMode ? { devMode: true as const } : {};
    const packagedDetail =
      resolution.packagedBuildProblems !== undefined &&
      resolution.packagedBuildProblems.length > 0
        ? `dev mode selected this candidate; a packaged build would reject it: ${problemMessages(resolution.packagedBuildProblems).join("; ")}`
        : undefined;
    const blocked =
      resolution.outcome === "incompatible"
        ? {
            version: resolution.newest.version,
            label: resolution.newest.label,
            reasons: problemMessages(resolution.reasons),
          }
        : resolution.blocked !== undefined
          ? {
              version: resolution.blocked.version.version,
              label: resolution.blocked.version.label,
              reasons: problemMessages(resolution.blocked.reasons),
            }
          : undefined;
    const rangeUpgrade =
      resolution.rangeUpgrade === undefined || savedRange === null
        ? undefined
        : {
            currentRange: savedRange,
            range: resolution.rangeUpgrade.range,
            basis: resolution.rangeUpgrade.basis,
            candidate: resolution.rangeUpgrade.candidate,
            breaking: resolution.rangeUpgrade.breaking,
            reasons: problemMessages(resolution.rangeUpgrade.reasons),
          };
    const common = {
      id,
      outcome: resolution.outcome,
      installed,
      ...dev,
      ...(blocked ? { blocked } : {}),
      ...(rangeUpgrade ? { rangeUpgrade } : {}),
      ...(packagedDetail ? { detail: packagedDetail } : {}),
    };
    if (resolution.outcome === "update-available") {
      return { ...common, candidate: resolution.candidate };
    }
    if (resolution.outcome === "unavailable") {
      return { ...common, detail: resolution.detail };
    }
    return common;
  }

  function persistUpdateEntry(entry: PluginUpdateCheckEntry): void {
    const changed = setInstalledPluginUpdateState(deps.db, entry.id, {
      lastCheckAt: now(),
      availableCompatibleVersion: entry.candidate?.version ?? null,
      newestIncompatibleVersion: entry.blocked?.version ?? null,
      statusDetail: JSON.stringify(entry),
    });
    if (!changed) {
      throw new Error(`plugin "${entry.id}" disappeared during update check`);
    }
  }

  async function legacyGitRefEvidence(args: {
    url: string;
    commit: string | null;
    ref: string;
  }): Promise<"tag" | "branch" | "unknown"> {
    if (args.commit === null) return "unknown";
    const parsed = parsePluginSource(`git:${args.url}@${args.commit}`);
    if (parsed.kind !== "git") return "unknown";
    let checkoutDir: string;
    try {
      checkoutDir = gitArtifactCacheDir(
        deps.dataDir,
        parsed.cachePath,
        args.commit,
      );
    } catch {
      return "unknown";
    }
    const hasRef = async (candidate: string): Promise<boolean> => {
      try {
        await runInstallCommand("git", [
          "-C",
          checkoutDir,
          "rev-parse",
          "--verify",
          "--quiet",
          candidate,
        ]);
        return true;
      } catch {
        return false;
      }
    };
    if (await hasRef(`refs/tags/${args.ref}`)) return "tag";
    if (await hasRef(`refs/remotes/origin/${args.ref}`)) return "branch";
    if (await hasRef(`refs/heads/${args.ref}`)) return "branch";
    return "unknown";
  }

  function npmIntentWithRange(
    row: InstalledPluginRow,
    range: string | undefined,
  ): NpmSourceIntentForResolution {
    const intent = npmIntentForRow(row);
    if (range === undefined) return intent;
    if (intent.specKind !== "range") {
      throw new Error(`plugin "${row.id}" does not follow an npm range`);
    }
    return { ...intent, requestedSpec: range };
  }

  async function classifiedGitIntentForRow(
    row: InstalledPluginRow,
    range?: string,
  ): Promise<
    | { outcome: "resolved"; url: string; selector: PluginGitSelector }
    | { outcome: "unavailable"; detail: string }
  > {
    if (row.sourceGitUrl === null) {
      throw new Error(`plugin "${row.id}" has corrupt normalized git state`);
    }
    const url = row.sourceGitUrl;
    const selector = gitSelectorForRow(row);
    if (range !== undefined) {
      if (selector?.kind !== "range") {
        throw new Error(`plugin "${row.id}" does not follow a git range`);
      }
      return { outcome: "resolved", url, selector: { ...selector, range } };
    }
    if (selector !== null) return { outcome: "resolved", url, selector };
    if (row.sourceGitRequestedRef === null) {
      throw new Error(`plugin "${row.id}" has corrupt normalized git state`);
    }
    const ref = row.sourceGitRequestedRef;
    const classified = await resolveGitRef({ url, ref });
    if (classified.outcome === "unavailable") return classified;
    if (classified.refKind === "branch") {
      const evidence = await legacyGitRefEvidence({
        url,
        commit: row.gitResolvedCommit,
        ref,
      });
      if (evidence !== "branch") {
        return {
          outcome: "unavailable",
          detail:
            `security check failed: ${url} now publishes "${ref}" as a branch, but this install ` +
            `${evidence === "tag" ? "recorded it as a tag" : "has no local record of its ref kind"}. ` +
            `bb keeps the plugin pinned to ${row.gitResolvedCommit ?? "its recorded commit"} rather than ` +
            "tracking that branch. Remove the plugin and install it again to accept the new ref",
        };
      }
    }
    if (
      !setInstalledPluginSourceClassification(deps.db, row.id, {
        kind: "git",
        refKind: classified.refKind,
      })
    ) {
      throw new Error(`plugin "${row.id}" disappeared during normalization`);
    }
    return {
      outcome: "resolved",
      url,
      selector: { kind: "ref", ref, refKind: classified.refKind },
    };
  }

  function activationSelectorForCandidate(args: {
    selector: PluginGitSelector;
    candidateCommit: string;
    candidateTag: string | undefined;
  }): PluginGitSelector {
    if (args.selector.kind === "ref") return args.selector;
    if (args.candidateTag === undefined) {
      throw new Error(
        `git candidate for ${args.candidateCommit} carries no resolved release tag`,
      );
    }
    return { ...args.selector, resolvedTag: args.candidateTag };
  }

  async function resolveUpdateForRow(args: {
    row: InstalledPluginRow;
    npmRun: NpmResolverRun;
    range?: string;
  }): Promise<PluginUpdateResolution> {
    const installed = installedUpdateVersion(args.row);
    if (args.row.sourceKind === "path" || args.row.sourceKind === "builtin") {
      return { outcome: "pinned", current: installed };
    }
    if (
      args.row.sourceKind === "npm" &&
      args.row.sourceNpmRegistry?.includes("bb-source=github-release")
    ) {
      return {
        outcome: "unavailable",
        detail:
          "installed from the retired remote marketplace — remove it and reinstall from Plugins → Browse plugins to switch to the bundled copy",
      };
    }
    const rangeUpgradeBasis: RangeUpgradeBasis =
      args.range === undefined
        ? rangeUpgradeBasisForRow(args.row)
        : { kind: "none" };
    if (args.row.sourceKind === "npm") {
      return resolveNpmUpdate({
        intent: npmIntentWithRange(args.row, args.range),
        current: installed,
        appVersion: deps.appVersion,
        run: args.npmRun,
        rangeUpgradeBasis,
      });
    }
    if (args.row.gitResolvedCommit === null) {
      throw new Error(
        `plugin "${args.row.id}" has corrupt normalized git state`,
      );
    }
    const intent = await classifiedGitIntentForRow(args.row, args.range);
    if (intent.outcome === "unavailable") return intent;
    const row = args.row;
    const probeGitCandidate: GitCandidateProbe = async (candidate) => {
      const cacheKey = JSON.stringify([
        row.id,
        row.sourceGitUrl,
        row.sourceGitSubdirectory,
        candidate.commit,
        deps.appVersion,
      ]);
      const cached = gitCandidateProbeCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const probed = await stageGitCandidate({
        row,
        commit: candidate.commit,
        promote: false,
      });
      const result: GitCandidateProbeResult =
        probed.outcome === "valid"
          ? {
              outcome: "compatible",
              devMode: probed.devMode,
              packagedBuildProblems: probed.packagedBuildProblems,
            }
          : probed;
      if (result.outcome !== "invalid") {
        gitCandidateProbeCache.set(cacheKey, result);
      }
      return result;
    };
    const remote = await resolveGitUpdate({
      url: intent.url,
      intent: intent.selector,
      currentCommit: args.row.gitResolvedCommit,
      probeCandidate: probeGitCandidate,
      rangeUpgradeBasis,
    });
    if (remote.outcome !== "update-available") return remote;
    if (intent.selector.kind === "range") return remote;
    if (
      row.sourceGitSubdirectory !== null &&
      (await gitSubdirectoryMatches({
        url: intent.url,
        installedCommit: args.row.gitResolvedCommit,
        candidateCommit: remote.candidate.version,
        subdirectory: row.sourceGitSubdirectory,
      }).catch(() => false))
    ) {
      return { outcome: "current", current: remote.current };
    }
    const staged = await stageGitCandidate({
      row: args.row,
      commit: remote.candidate.version,
      promote: false,
    });
    if (staged.outcome === "invalid") {
      return { outcome: "unavailable", detail: staged.detail };
    }
    if (staged.outcome === "incompatible") {
      return {
        outcome: "incompatible",
        current: remote.current,
        newest: remote.candidate,
        reasons: staged.reasons,
        ...(staged.devMode ? { devMode: true } : {}),
      };
    }
    return {
      ...remote,
      ...(staged.devMode ? { devMode: true } : {}),
      ...(staged.packagedBuildProblems.length > 0
        ? { packagedBuildProblems: staged.packagedBuildProblems }
        : {}),
    };
  }

  const scheduleUpdateCheck =
    deps.scheduleUpdateCheck ??
    ((delayMs: number, onElapsed: () => void) => {
      const timer = setTimeout(onElapsed, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });
  let cancelPeriodicCheck: (() => void) | null = null;
  let periodicChecksStopped = true;
  let inFlightSweep: Promise<PluginUpdateCheckEntry[]> | null = null;

  function periodicCheckDelay(): number {
    const stamps = listInstalledPlugins(deps.db)
      .filter(
        (row) => row.sourceKind !== "path" && row.sourceKind !== "builtin",
      )
      .map((row) => row.lastUpdateCheckAt);
    if (stamps.length === 0) return PLUGIN_UPDATE_CHECK_INTERVAL_MS;
    if (stamps.includes(null)) return 0;
    const oldest = Math.min(...stamps.filter((stamp) => stamp !== null));
    return Math.max(0, PLUGIN_UPDATE_CHECK_INTERVAL_MS - (now() - oldest));
  }

  async function runPeriodicCheck(): Promise<void> {
    if (periodicChecksStopped) return;
    if (isServerMoveFrozen(deps.db)) {
      cancelPeriodicCheck = scheduleUpdateCheck(
        SERVER_MOVE_FROZEN_RETRY_MS,
        runPeriodicCheck,
      );
      return;
    }
    try {
      await updates.checkForUpdates();
    } catch (error: unknown) {
      deps.logger.warn({ err: error }, "periodic plugin update check failed");
    } finally {
      if (!periodicChecksStopped) {
        cancelPeriodicCheck = scheduleUpdateCheck(
          PLUGIN_UPDATE_CHECK_INTERVAL_MS,
          runPeriodicCheck,
        );
      }
    }
  }

  async function checkRows(
    rows: InstalledPluginRow[],
  ): Promise<PluginUpdateCheckEntry[]> {
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const results: PluginUpdateCheckEntry[] = [];
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const index = next++;
        const row = rows[index] as InstalledPluginRow;
        results[index] = await withLifecycleLock(row.id, async () => {
          const current = getInstalledPlugin(deps.db, row.id);
          if (!current) {
            throw new Error(
              `plugin "${row.id}" disappeared during update check`,
            );
          }
          let resolution: PluginUpdateResolution;
          try {
            resolution = await resolveUpdateForRow({
              row: current,
              npmRun: npmRunForRow(current),
            });
          } catch (error) {
            resolution = {
              outcome: "unavailable",
              detail: error instanceof Error ? error.message : String(error),
            };
          }
          const checked = checkEntryFromResolution(
            current,
            installedUpdateVersion(current),
            resolution,
          );
          persistUpdateEntry(checked);
          return checked;
        });
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(UPDATE_CHECK_CONCURRENCY, rows.length) },
        worker,
      ),
    );
    notifyPluginsChanged();
    return results;
  }

  const updates: PluginUpdates = {
    startPeriodicUpdateChecks() {
      if (!periodicChecksStopped) return;
      periodicChecksStopped = false;
      cancelPeriodicCheck = scheduleUpdateCheck(
        periodicCheckDelay(),
        runPeriodicCheck,
      );
    },

    async stopPeriodicUpdateChecks() {
      periodicChecksStopped = true;
      cancelPeriodicCheck?.();
      cancelPeriodicCheck = null;
      await inFlightSweep?.catch(() => undefined);
    },

    checkForUpdates(id) {
      if (id !== undefined) {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) throw new Error(`unknown plugin "${id}"`);
        return checkRows([row]);
      }
      inFlightSweep ??= checkRows(listInstalledPlugins(deps.db)).finally(() => {
        inFlightSweep = null;
      });
      return inFlightSweep;
    },

    listUpdateResults() {
      return listInstalledPlugins(deps.db)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((row) => {
          if (
            row.lastUpdateCheckAt === null ||
            row.updateStatusDetail === null
          ) {
            return {
              id: row.id,
              outcome: "unavailable" as const,
              installed: installedUpdateVersion(row),
              detail: "updates have not been checked yet",
            };
          }
          const persisted = parsePersistedUpdateEntry(row);
          if (persisted === null) {
            throw new Error(
              `plugin "${row.id}" has corrupt persisted update state`,
            );
          }
          return persisted;
        });
    },

    async getSource(id) {
      const row = getInstalledPlugin(deps.db, id);
      if (row === undefined) return undefined;
      const manifest = await readPluginManifest(row.rootDir).catch(() => null);
      const artifacts = listRecentPluginArtifacts(deps.db, id, 10);
      return {
        requested: row.source,
        resolved: installedUpdateVersion(row).display,
        ...(row.sourceGitSubdirectory === null
          ? {}
          : { subdirectory: row.sourceGitSubdirectory }),
        ...(row.sourceGitRange === null ? {} : { range: row.sourceGitRange }),
        ...(row.sourceGitTagPrefix === null ||
        row.sourceGitTagPrefix.length === 0
          ? {}
          : { tagPrefix: row.sourceGitTagPrefix }),
        ...(row.sourceGitResolvedTag === null
          ? {}
          : { resolvedTag: row.sourceGitResolvedTag }),
        ...(row.npmIntegrity === null ? {} : { integrity: row.npmIntegrity }),
        ...(row.sourceNpmRegistry === null
          ? {}
          : { registry: row.sourceNpmRegistry }),
        engines: {
          ...(manifest?.bbEngineRange === undefined
            ? {}
            : { bb: manifest.bbEngineRange }),
          ...(manifest?.bbPluginSdkRange === undefined
            ? {}
            : { bbPluginSdk: manifest.bbPluginSdkRange }),
        },
        installedAt: row.installedAt,
        history: artifacts.map((artifact) => ({
          version:
            artifact.sourceKind === "npm"
              ? (artifact.npmResolvedVersion ?? "unknown")
              : (artifact.gitResolvedCommit ?? "unknown"),
          activatedAt: artifact.validatedAt ?? artifact.updatedAt,
        })),
      };
    },

    async applyUpdate(id, options = {}) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) return { ok: false, error: `unknown plugin "${id}"` };
        const safeModeRefusal = safeModeActivationRefusal({
          pluginId: id,
          provenance: row.provenance,
          builtinName:
            row.sourceKind === "builtin" ? row.sourceBuiltinName : null,
          action: "update",
        });
        if (safeModeRefusal !== null) {
          return { ok: false, error: safeModeRefusal };
        }
        const range =
          options.range === undefined || options.range === savedRangeForRow(row)
            ? undefined
            : options.range;
        if (range !== undefined) {
          const problem = rangeChangeProblem(row, range);
          if (problem !== null) return { ok: false, error: problem };
        }
        const from = installedUpdateVersion(row);
        const npmRun = npmRunForRow(row);
        const selectionNpmIntent =
          row.sourceKind === "npm" ? npmIntentWithRange(row, range) : undefined;
        const resolution = await resolveUpdateForRow({
          row,
          npmRun,
          ...(range === undefined ? {} : { range }),
        });
        if (range === undefined) {
          persistUpdateEntry(checkEntryFromResolution(row, from, resolution));
        }
        const refuseRangeChange = async (
          error: string,
        ): Promise<PluginApplyUpdateOutcome> => {
          const fresh = await resolveUpdateForRow({ row, npmRun });
          persistUpdateEntry(checkEntryFromResolution(row, from, fresh));
          return { ok: false, error };
        };

        if (resolution.outcome === "pinned") {
          return {
            ok: false,
            error:
              row.sourceKind === "path"
                ? `plugin "${id}" is a local path source with no update channel; edit it in place and run \`bb plugin reload ${id}\`, or move it with \`bb plugin install path:<new directory>\` (settings, secrets, and schedules are kept)`
                : `plugin "${id}" is pinned by its source intent; remove and reinstall it with an npm range, a git branch, or a git semver range to track updates`,
          };
        }
        if (resolution.outcome === "incompatible") {
          return {
            ok: false,
            error: `${resolution.newest.display} is incompatible: ${problemMessages(resolution.reasons).join("; ")}`,
          };
        }
        if (resolution.outcome === "unavailable") {
          return { ok: false, error: resolution.detail };
        }
        const to =
          resolution.outcome === "update-available"
            ? resolution.candidate
            : from;
        if (resolution.outcome === "current") {
          if (range !== undefined) {
            return refuseRangeChange(
              `${range} admits no release newer than the installed ${from.label}; the range was not changed`,
            );
          }
          return {
            ok: true,
            result: {
              applied: false,
              from,
              outcome: "current",
            },
          };
        }
        if (range !== undefined) {
          const installedRelease = installedReleaseVersion(row);
          const candidateRelease = candidateReleaseVersion(row, resolution);
          if (
            installedRelease === null ||
            candidateRelease === null ||
            !semver.gt(candidateRelease, installedRelease)
          ) {
            return refuseRangeChange(
              `${range} resolves to ${resolution.candidate.label}, which is not newer than the installed ${from.label}; bb does not downgrade plugins`,
            );
          }
        }
        if (
          options.expectedVersion !== undefined &&
          options.expectedVersion !== resolution.candidate.version
        ) {
          const error = `update refused: the release changed after you reviewed it; you reviewed ${reviewedReleaseLabel(row, options.expectedVersion)}, and bb now resolves ${resolution.candidate.label}. Review ${resolution.candidate.label} before updating`;
          return range === undefined
            ? { ok: false, error }
            : refuseRangeChange(error);
        }

        try {
          if (row.sourceKind === "npm" && selectionNpmIntent !== undefined) {
            const selected = await selectNpmCandidate({
              intent: selectionNpmIntent,
              appVersion: deps.appVersion,
              run: npmRun,
            });
            if (selected.outcome !== "selected") {
              throw new Error(
                `npm candidate changed during update: ${selected.outcome}`,
              );
            }
            if (selected.candidate.version !== to.version) {
              throw new Error(
                `npm candidate changed during update: resolved ${to.version}, selected ${selected.candidate.version}`,
              );
            }
            const activationRow = getInstalledPlugin(deps.db, id);
            if (activationRow === undefined) {
              throw new Error(`plugin "${id}" disappeared before activation`);
            }
            await applyNpmCandidate({
              row: activationRow,
              selectionIntent: selectionNpmIntent,
              candidate: selected.candidate,
            });
          } else if (
            row.sourceKind === "git" &&
            resolution.outcome === "update-available"
          ) {
            const activationRow = getInstalledPlugin(deps.db, id);
            if (activationRow === undefined) {
              throw new Error(`plugin "${id}" disappeared before activation`);
            }
            const intent = await classifiedGitIntentForRow(
              activationRow,
              range,
            );
            if (intent.outcome === "unavailable") {
              return { ok: false, error: intent.detail };
            }
            const staged = await stageGitCandidate({
              row: activationRow,
              commit: resolution.candidate.version,
              promote: true,
              activationSelector: activationSelectorForCandidate({
                selector: intent.selector,
                candidateCommit: resolution.candidate.version,
                candidateTag: resolution.candidateGitTag,
              }),
              ...(range === undefined || intent.selector.kind !== "range"
                ? {}
                : {
                    activationSource: gitRangeSourceSpec({
                      url: intent.url,
                      range,
                      tagPrefix: intent.selector.tagPrefix,
                    }),
                  }),
            });
            if (staged.outcome !== "valid") {
              const detail =
                staged.outcome === "invalid"
                  ? staged.detail
                  : problemMessages(staged.reasons).join("; ");
              return { ok: false, error: `update refused: ${detail}` };
            }
          }
        } catch (error) {
          if (error instanceof PluginActivationRolledBackError) {
            return {
              ok: true,
              result: {
                applied: false,
                from,
                to,
                outcome: "rolled-back",
                detail: error.message,
              },
            };
          }
          throw error;
        }
        await removeUnusedPluginArtifacts({
          db: deps.db,
          dataDir: deps.dataDir,
          pluginId: id,
          warn: (message) => deps.logger.warn(message),
        });
        await runArtifactGc();
        const updatedRow = getInstalledPlugin(deps.db, id);
        if (!updatedRow) {
          throw new Error(`plugin "${id}" disappeared after update`);
        }
        const updatedVersion = installedUpdateVersion(updatedRow);
        persistUpdateEntry(
          checkEntryFromResolution(updatedRow, updatedVersion, {
            outcome: "current",
            current: updatedVersion,
            ...(semver.coerce(deps.appVersion)?.version === "0.0.0"
              ? { devMode: true }
              : {}),
            ...(range === undefined && resolution.rangeUpgrade !== undefined
              ? { rangeUpgrade: resolution.rangeUpgrade }
              : {}),
          }),
        );
        return {
          ok: true,
          result: {
            applied: true,
            from,
            to,
            outcome: "updated",
          },
        };
      });
    },
  };
  return updates;
}
