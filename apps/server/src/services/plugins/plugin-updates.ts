import semver from "semver";
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
} from "./update-resolver.js";
import { PluginActivationRolledBackError } from "./plugin-activation.js";
import type { createPluginActivation } from "./plugin-activation.js";
import {
  createListedRegistryNpmResolverRun,
  type createManagedPluginArtifacts,
} from "./managed-plugin-artifacts.js";
import { MARKETPLACE_FETCH_TIMEOUT_MS } from "../plugin-catalog/marketplace-http.js";
import { pluginUpdateCheckEntrySchema } from "./plugin-service-internal.js";
import type {
  PluginApplyUpdateOutcome,
  PluginServiceDeps,
  PluginSourceView,
  PluginUpdateCheckEntry,
} from "./plugin-service-internal.js";

export const PLUGIN_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
/** A git range check can stage several clones per plugin; bound the fan-out. */
const UPDATE_CHECK_CONCURRENCY = 4;

/**
 * A catalog listing named its registry, so its rows use the guarded
 * marketplace transport exactly as installation did. Direct `npm:` installs
 * keep the user's registry on the default transport, time-boxed.
 */
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
  /** Sweep every plugin on a fixed interval, due from the stalest check. */
  startPeriodicUpdateChecks(): void;
  /** Cancels the next sweep and waits for one in flight to finish. */
  stopPeriodicUpdateChecks(): Promise<void>;
  listUpdateResults(): PluginUpdateCheckEntry[];
  getSource(id: string): Promise<PluginSourceView | undefined>;
  applyUpdate(id: string): Promise<PluginApplyUpdateOutcome>;
}

export interface PluginUpdatesContext {
  deps: PluginServiceDeps;
  registrationMutationKey: string;
  withLifecycleLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  withPluginOperationLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  notifyPluginsChanged: () => void;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
  npmIntentForRow: (row: InstalledPluginRow) => NpmSourceIntentForResolution;
  managedArtifacts: Pick<
    ReturnType<typeof createManagedPluginArtifacts>,
    "applyNpmCandidate" | "stageGitCandidate"
  >;
  runArtifactGc: ReturnType<typeof createPluginActivation>["runArtifactGc"];
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
    managedArtifacts: { applyNpmCandidate, stageGitCandidate },
    runArtifactGc,
  } = context;
  const now = deps.now ?? Date.now;
  // A commit is immutable. Keep its manifest compatibility result for this
  // server process so the six-hour sweep does not clone the same releases.
  const gitCandidateProbeCache = new Map<string, GitCandidateProbeResult>();

  function problemMessages(problems: CompatibilityProblem[]): string[] {
    return problems.map((problem) => problem.message);
  }

  function checkEntryFromResolution(
    id: string,
    installed: PluginResolvedUpdateVersion,
    resolution: PluginUpdateResolution,
  ): PluginUpdateCheckEntry {
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
            reasons: problemMessages(resolution.reasons),
          }
        : resolution.blocked !== undefined
          ? {
              version: resolution.blocked.version.version,
              reasons: problemMessages(resolution.blocked.reasons),
            }
          : undefined;
    const common = {
      id,
      outcome: resolution.outcome,
      installed,
      ...dev,
      ...(blocked ? { blocked } : {}),
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

  /**
   * What the install-time clone says a legacy ref was. `git clone` copies
   * every ref, so the cached checkout still holds the tags and branches the
   * remote published when bb installed the plugin. "unknown" means the
   * checkout or its refs are gone, which is not evidence of anything.
   */
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

  /**
   * The git intent of a row, classifying a legacy ref that was persisted
   * before bb recorded whether it names a branch, a tag, or a commit.
   */
  async function classifiedGitIntentForRow(
    row: InstalledPluginRow,
  ): Promise<
    | { outcome: "resolved"; url: string; selector: PluginGitSelector }
    | { outcome: "unavailable"; detail: string }
  > {
    if (row.sourceGitUrl === null) {
      throw new Error(`plugin "${row.id}" has corrupt normalized git state`);
    }
    const url = row.sourceGitUrl;
    const selector = gitSelectorForRow(row);
    if (selector !== null) return { outcome: "resolved", url, selector };
    if (row.sourceGitRequestedRef === null) {
      throw new Error(`plugin "${row.id}" has corrupt normalized git state`);
    }
    const ref = row.sourceGitRequestedRef;
    const classified = await resolveGitRef({ url, ref });
    if (classified.outcome === "unavailable") return classified;
    // A tag is a pin; a branch tracks whatever the remote later publishes.
    // The remote alone cannot decide which one a legacy row installed: an
    // attacker who deletes a tag and pushes a same-name branch would turn the
    // pin into tracking and get the next update installed as trusted code.
    // The install-time clone is the local evidence, and it is not on the
    // network.
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

  /**
   * The selector to persist when a git candidate activates. The resolution
   * carries the exact tag it selected and displayed, so activation stores
   * that pair. A second tag query here would be a window: a higher tag added
   * to the same commit between approval and activation would be recorded as
   * the installed release, and the stored release would differ from the one
   * the user approved.
   */
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
    npmIntentOverride?: NpmSourceIntentForResolution;
  }): Promise<PluginUpdateResolution> {
    const installed = installedUpdateVersion(args.row);
    if (args.row.sourceKind === "path" || args.row.sourceKind === "builtin") {
      return { outcome: "pinned", current: installed };
    }
    // Rows installed through the retired GitHub-Release marketplace carry a
    // synthetic api.github.com registry URL no npm resolver can serve. The
    // plugin keeps running from its cached artifact; updates now ride app
    // releases, so point the user at a store reinstall instead of erroring.
    if (
      args.row.sourceKind === "npm" &&
      args.row.sourceNpmRegistry?.includes("bb-source=github-release")
    ) {
      return {
        outcome: "unavailable",
        detail:
          "installed from the retired remote marketplace — remove it and reinstall from Extensions → Plugins → Browse to switch to the bundled copy",
      };
    }
    if (args.row.sourceKind === "npm") {
      return resolveNpmUpdate({
        intent: args.npmIntentOverride ?? npmIntentForRow(args.row),
        current: installed,
        appVersion: deps.appVersion,
        run: args.npmRun,
        includePinned: args.npmIntentOverride !== undefined,
      });
    }
    if (args.row.gitResolvedCommit === null) {
      throw new Error(
        `plugin "${args.row.id}" has corrupt normalized git state`,
      );
    }
    const intent = await classifiedGitIntentForRow(args.row);
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
      // A transient clone or parse failure can recover. Compatibility is a
      // property of this immutable commit and the running bb version.
      if (result.outcome !== "invalid") {
        gitCandidateProbeCache.set(cacheKey, result);
      }
      return result;
    };
    // A range tracks whatever release this bb can run, so the resolver walks
    // its matching tags. A ref names one commit, so it is staged once here.
    const remote = await resolveGitUpdate({
      url: intent.url,
      intent: intent.selector,
      currentCommit: args.row.gitResolvedCommit,
      ...(intent.selector.kind === "range"
        ? { probeCandidate: probeGitCandidate }
        : {}),
    });
    if (remote.outcome !== "update-available") return remote;
    if (intent.selector.kind === "range") return remote;
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

  /** Delay until the stalest network-reachable plugin is due; null rows are due now. */
  function periodicCheckDelay(): number {
    const stamps = listInstalledPlugins(deps.db)
      .filter(
        (row) => row.sourceKind !== "path" && row.sourceKind !== "builtin",
      )
      .map((row) => row.lastUpdateCheckAt);
    if (stamps.includes(null)) return 0;
    const oldest = Math.min(...stamps.filter((stamp) => stamp !== null));
    return Math.max(0, PLUGIN_UPDATE_CHECK_INTERVAL_MS - (now() - oldest));
  }

  function runPeriodicCheck(): void {
    if (periodicChecksStopped) return;
    void updates
      .checkForUpdates()
      .catch((error: unknown) => {
        deps.logger.warn({ err: error }, "periodic plugin update check failed");
      })
      .finally(() => {
        // A full interval, not periodicCheckDelay(): a failed sweep persists
        // nothing and would otherwise retry at once.
        if (!periodicChecksStopped) {
          cancelPeriodicCheck = scheduleUpdateCheck(
            PLUGIN_UPDATE_CHECK_INTERVAL_MS,
            runPeriodicCheck,
          );
        }
      });
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
          const resolution = await resolveUpdateForRow({
            row: current,
            npmRun: npmRunForRow(current),
          });
          const checked = checkEntryFromResolution(
            current.id,
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
      // Let a sweep drain so plugin shutdown does not queue behind its locks.
      await inFlightSweep?.catch(() => undefined);
    },

    checkForUpdates(id) {
      if (id !== undefined) {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) throw new Error(`unknown plugin "${id}"`);
        return checkRows([row]);
      }
      // Concurrent full sweeps join the one in flight instead of re-fetching.
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
          let json: unknown;
          try {
            json = JSON.parse(row.updateStatusDetail);
          } catch {
            throw new Error(
              `plugin "${row.id}" has corrupt persisted update state`,
            );
          }
          const parsed = pluginUpdateCheckEntrySchema.safeParse(json);
          if (!parsed.success || parsed.data.id !== row.id) {
            throw new Error(
              `plugin "${row.id}" has corrupt persisted update state`,
            );
          }
          return parsed.data;
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

    async applyUpdate(id) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) return { ok: false, error: `unknown plugin "${id}"` };
        const from = installedUpdateVersion(row);
        const npmRun = npmRunForRow(row);
        const selectionNpmIntent =
          row.sourceKind === "npm" ? npmIntentForRow(row) : undefined;
        const resolution = await resolveUpdateForRow({
          row,
          npmRun,
        });
        const checked = checkEntryFromResolution(id, from, resolution);
        persistUpdateEntry(checked);

        if (resolution.outcome === "pinned") {
          return {
            ok: false,
            error: `plugin "${id}" is pinned by its source intent; remove and reinstall it with an npm range, a git branch, or a git semver range to track updates`,
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
          return {
            ok: true,
            result: {
              applied: false,
              from,
              outcome: "current",
            },
          };
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
              sourceIntent: selectionNpmIntent,
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
            // resolveUpdateForRow classified the row a moment ago, so this
            // reads the persisted intent rather than reaching the network.
            const intent = await classifiedGitIntentForRow(activationRow);
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
        await runArtifactGc();
        const updatedRow = getInstalledPlugin(deps.db, id);
        if (!updatedRow) {
          throw new Error(`plugin "${id}" disappeared after update`);
        }
        const updatedVersion = installedUpdateVersion(updatedRow);
        persistUpdateEntry(
          checkEntryFromResolution(id, updatedVersion, {
            outcome: "current",
            current: updatedVersion,
            ...(semver.coerce(deps.appVersion)?.version === "0.0.0"
              ? { devMode: true }
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
