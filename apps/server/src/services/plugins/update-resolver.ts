import semver from "semver";
import { z } from "zod";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import {
  DEFAULT_GIT_REF,
  isCommitSha,
  runInstallCommand,
} from "./install-sources.js";

export type NpmSpecKind = "default" | "exact" | "tag" | "range";
export type GitRefKind = "branch" | "tag" | "commit";

export interface CompatibilityProblem {
  engine: "bb" | "bbPluginSdk";
  required: string;
  actual: string;
  message: string;
}

export interface PluginResolvedUpdateVersion {
  /** Exact npm version or git commit. */
  version: string;
  display: string;
}

interface ResolutionFlags {
  devMode?: true;
  /** A newer allowed version was rejected while an older one was selected. */
  blocked?: {
    version: PluginResolvedUpdateVersion;
    reasons: CompatibilityProblem[];
  };
  /** In dev mode, what engines.bb would decide if 0.0.0 were enforced. */
  packagedBuildProblems?: CompatibilityProblem[];
}

export type PluginUpdateResolution =
  | ({
      outcome: "current";
      current: PluginResolvedUpdateVersion;
    } & ResolutionFlags)
  | ({
      outcome: "update-available";
      current: PluginResolvedUpdateVersion;
      candidate: PluginResolvedUpdateVersion;
    } & ResolutionFlags)
  | ({
      outcome: "pinned";
      current: PluginResolvedUpdateVersion;
    } & ResolutionFlags)
  | ({
      outcome: "incompatible";
      current?: PluginResolvedUpdateVersion;
      newest: PluginResolvedUpdateVersion;
      reasons: CompatibilityProblem[];
    } & ResolutionFlags)
  | ({ outcome: "unavailable"; detail: string } & ResolutionFlags);

export interface NpmSourceIntentForResolution {
  packageName: string;
  registry: string;
  requestedSpec: string;
  specKind: NpmSpecKind;
}

export interface NpmResolvedCandidate extends PluginResolvedUpdateVersion {
  integrity: string;
  engines: {
    bb: string | undefined;
    bbPluginSdk: string | undefined;
  };
}

const packumentVersionSchema = z.object({
  version: z.string(),
  engines: z
    .object({
      bb: z.string().optional(),
      bbPluginSdk: z.string().optional(),
    })
    .optional(),
  dist: z
    .object({
      integrity: z.string().optional(),
      tarball: z.string().url().optional(),
    })
    .optional(),
});

const packumentSchema = z.object({
  versions: z.record(z.string(), packumentVersionSchema),
  "dist-tags": z.record(z.string(), z.string()).default({}),
});

type Packument = z.infer<typeof packumentSchema>;

export interface NpmResolverRun {
  getPackument(intent: NpmSourceIntentForResolution): Promise<Packument>;
}

export function createNpmResolverRun(options?: {
  fetch?: typeof fetch;
}): NpmResolverRun {
  const fetchImpl = options?.fetch ?? fetch;
  const cache = new Map<string, Promise<Packument>>();
  return {
    getPackument(intent) {
      const registry = intent.registry.replace(/\/+$/, "");
      const key = `${registry}\n${intent.packageName}`;
      const existing = cache.get(key);
      if (existing) return existing;
      const pending = (async () => {
        let response: Response;
        try {
          response = await fetchImpl(
            `${registry}/${encodeURIComponent(intent.packageName)}`,
            {
              headers: {
                accept: "application/vnd.npm.install-v1+json, application/json",
              },
            },
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new NpmPackageUnavailableError(
            `${intent.packageName} registry request failed: ${detail}`,
          );
        }
        if (!response.ok) {
          throw new NpmPackageUnavailableError(
            `${intent.packageName} registry request failed: ${response.status} ${response.statusText}`,
          );
        }
        const json: unknown = await response.json();
        const parsed = packumentSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(
            `registry returned malformed metadata for ${intent.packageName}: ${parsed.error.issues[0]?.message ?? "invalid packument"}`,
          );
        }
        return parsed.data;
      })();
      cache.set(key, pending);
      return pending;
    },
  };
}

class NpmPackageUnavailableError extends Error {}

function requestedRangeIncludesPrerelease(spec: string): boolean {
  const range = new semver.Range(spec);
  return range.set.some((comparators) =>
    comparators.some((comparator) => comparator.semver.prerelease.length > 0),
  );
}

function allowedNpmVersions(
  packument: Packument,
  intent: NpmSourceIntentForResolution,
): string[] | { unavailable: string } {
  let versions: string[];
  if (intent.specKind === "exact") {
    versions = [intent.requestedSpec];
  } else if (intent.specKind === "tag") {
    const tagged = packument["dist-tags"][intent.requestedSpec];
    if (tagged === undefined) {
      return {
        unavailable: `npm dist-tag "${intent.requestedSpec}" does not exist for ${intent.packageName}`,
      };
    }
    versions = [tagged];
  } else if (intent.specKind === "range") {
    versions = Object.keys(packument.versions).filter((version) =>
      semver.satisfies(version, intent.requestedSpec),
    );
  } else {
    versions = Object.keys(packument.versions).filter(
      (version) => semver.valid(version) !== null,
    );
  }

  const permitsPrerelease =
    (intent.specKind === "exact" &&
      semver.prerelease(intent.requestedSpec) !== null) ||
    (intent.specKind === "range" &&
      requestedRangeIncludesPrerelease(intent.requestedSpec));
  return versions
    .filter((version) => semver.valid(version) !== null)
    .filter(
      (version) => permitsPrerelease || semver.prerelease(version) === null,
    )
    .sort(semver.rcompare);
}

export function evaluateCompatibility(args: {
  bbRange: string | undefined;
  sdkRange: string | undefined;
  appVersion: string;
}): {
  effective: CompatibilityProblem[];
  packaged: CompatibilityProblem[];
  devMode: boolean;
} {
  const appVersion = semver.coerce(args.appVersion);
  if (!appVersion) {
    throw new Error(`cannot parse running bb version "${args.appVersion}"`);
  }
  const devMode = appVersion.version === "0.0.0";
  const bbProblems: CompatibilityProblem[] = [];
  if (args.bbRange !== undefined) {
    if (semver.validRange(args.bbRange) === null) {
      bbProblems.push({
        engine: "bb",
        required: args.bbRange,
        actual: appVersion.version,
        message: `declares invalid engines.bb range ${JSON.stringify(args.bbRange)}`,
      });
    } else if (!semver.satisfies(appVersion, args.bbRange)) {
      bbProblems.push({
        engine: "bb",
        required: args.bbRange,
        actual: appVersion.version,
        message: `requires bb ${args.bbRange}, running bb is ${appVersion.version}`,
      });
    }
  }
  const sdkProblems: CompatibilityProblem[] = [];
  if (args.sdkRange !== undefined) {
    if (semver.validRange(args.sdkRange) === null) {
      sdkProblems.push({
        engine: "bbPluginSdk",
        required: args.sdkRange,
        actual: PLUGIN_SDK_VERSION,
        message: `declares invalid engines.bbPluginSdk range ${JSON.stringify(args.sdkRange)}`,
      });
    } else if (!semver.satisfies(PLUGIN_SDK_VERSION, args.sdkRange)) {
      sdkProblems.push({
        engine: "bbPluginSdk",
        required: args.sdkRange,
        actual: PLUGIN_SDK_VERSION,
        message: `requires bb plugin SDK ${args.sdkRange}, running SDK is ${PLUGIN_SDK_VERSION}`,
      });
    }
  }
  return {
    effective: devMode ? sdkProblems : [...bbProblems, ...sdkProblems],
    packaged: bbProblems,
    devMode,
  };
}

function npmDisplay(packageName: string, version: string): string {
  return `${packageName}@${version}`;
}

/** Select the newest allowed compatible npm artifact from one cached run. */
export async function selectNpmCandidate(args: {
  intent: NpmSourceIntentForResolution;
  appVersion: string;
  run: NpmResolverRun;
}): Promise<
  | {
      outcome: "selected";
      candidate: NpmResolvedCandidate;
      blocked?: {
        candidate: NpmResolvedCandidate;
        reasons: CompatibilityProblem[];
      };
      packagedBuildProblems: CompatibilityProblem[];
      devMode: boolean;
    }
  | {
      outcome: "incompatible";
      newest: NpmResolvedCandidate;
      reasons: CompatibilityProblem[];
      devMode: boolean;
    }
  | { outcome: "unavailable"; detail: string; devMode: boolean }
> {
  let packument: Packument;
  try {
    packument = await args.run.getPackument(args.intent);
  } catch (error) {
    if (error instanceof NpmPackageUnavailableError) {
      return {
        outcome: "unavailable",
        detail: error.message,
        devMode: semver.coerce(args.appVersion)?.version === "0.0.0",
      };
    }
    throw error;
  }
  const allowed = allowedNpmVersions(packument, args.intent);
  const devMode = semver.coerce(args.appVersion)?.version === "0.0.0";
  if (!Array.isArray(allowed)) {
    return { outcome: "unavailable", detail: allowed.unavailable, devMode };
  }
  if (allowed.length === 0) {
    return {
      outcome: "unavailable",
      detail: `no published version of ${args.intent.packageName} matches ${args.intent.requestedSpec || "stable releases"}`,
      devMode,
    };
  }

  let newestCandidate: NpmResolvedCandidate | undefined;
  let newestProblems: CompatibilityProblem[] = [];
  let blocked:
    | { candidate: NpmResolvedCandidate; reasons: CompatibilityProblem[] }
    | undefined;
  for (const version of allowed) {
    const metadata = packument.versions[version];
    if (!metadata) continue;
    const candidate: NpmResolvedCandidate = {
      version,
      display: npmDisplay(args.intent.packageName, version),
      integrity: metadata.dist?.integrity ?? "",
      engines: {
        bb: metadata.engines?.bb,
        bbPluginSdk: metadata.engines?.bbPluginSdk,
      },
    };
    const problems = evaluateCompatibility({
      bbRange: candidate.engines.bb,
      sdkRange: candidate.engines.bbPluginSdk,
      appVersion: args.appVersion,
    });
    newestCandidate ??= candidate;
    if (newestCandidate === candidate) newestProblems = problems.effective;
    if (problems.effective.length > 0) {
      blocked ??= { candidate, reasons: problems.effective };
      continue;
    }
    if (candidate.integrity.length === 0) {
      throw new Error(
        `registry metadata has no dist.integrity for ${candidate.display}`,
      );
    }
    return {
      outcome: "selected",
      candidate,
      ...(blocked ? { blocked } : {}),
      packagedBuildProblems: problems.packaged,
      devMode: problems.devMode,
    };
  }
  if (!newestCandidate) {
    return {
      outcome: "unavailable",
      detail: `registry metadata contains no usable versions for ${args.intent.packageName}`,
      devMode,
    };
  }
  return {
    outcome: "incompatible",
    newest: newestCandidate,
    reasons: newestProblems,
    devMode,
  };
}

export async function resolveNpmUpdate(args: {
  intent: NpmSourceIntentForResolution;
  current: PluginResolvedUpdateVersion;
  appVersion: string;
  run: NpmResolverRun;
  includePinned?: boolean;
}): Promise<PluginUpdateResolution> {
  const devMode = semver.coerce(args.appVersion)?.version === "0.0.0";
  if (args.intent.specKind === "exact" && args.includePinned !== true) {
    return {
      outcome: "pinned",
      current: args.current,
      ...(devMode ? { devMode: true } : {}),
    };
  }
  const selected = await selectNpmCandidate(args);
  const flags = {
    ...(selected.devMode ? { devMode: true as const } : {}),
  };
  if (selected.outcome === "unavailable") {
    return { outcome: "unavailable", detail: selected.detail, ...flags };
  }
  if (selected.outcome === "incompatible") {
    return {
      outcome: "incompatible",
      current: args.current,
      newest: selected.newest,
      reasons: selected.reasons,
      ...flags,
    };
  }
  const extra = {
    ...flags,
    ...(selected.blocked
      ? {
          blocked: {
            version: selected.blocked.candidate,
            reasons: selected.blocked.reasons,
          },
        }
      : {}),
    ...(selected.packagedBuildProblems.length > 0
      ? { packagedBuildProblems: selected.packagedBuildProblems }
      : {}),
  };
  if (selected.candidate.version === args.current.version) {
    return { outcome: "current", current: args.current, ...extra };
  }
  return {
    outcome: "update-available",
    current: args.current,
    candidate: selected.candidate,
    ...extra,
  };
}

function parseLsRemote(output: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) continue;
    const [commit, ref, extra] = line.trim().split(/\s+/);
    if (extra !== undefined || commit === undefined || ref === undefined) {
      throw new Error(
        `malformed git ls-remote output: ${JSON.stringify(line)}`,
      );
    }
    if (!/^[0-9a-f]{40}$/i.test(commit)) {
      throw new Error(
        `git ls-remote returned invalid object id ${JSON.stringify(commit)}`,
      );
    }
    refs.set(ref, commit.toLowerCase());
  }
  return refs;
}

export async function resolveGitRef(args: {
  url: string;
  ref: string;
}): Promise<
  | { outcome: "resolved"; refKind: GitRefKind; commit: string }
  | { outcome: "unavailable"; detail: string }
> {
  if (isCommitSha(args.ref)) {
    return {
      outcome: "resolved",
      refKind: "commit",
      commit: args.ref.toLowerCase(),
    };
  }
  if (args.ref === DEFAULT_GIT_REF) {
    const output = await runInstallCommand(
      "git",
      ["ls-remote", args.url, DEFAULT_GIT_REF],
      {
        notFoundHint:
          '"git" was not found on PATH — git plugin updates require git',
      },
    );
    const commit = parseLsRemote(output).get(DEFAULT_GIT_REF);
    return commit === undefined
      ? {
          outcome: "unavailable",
          detail: `git default branch was not found in ${args.url}`,
        }
      : { outcome: "resolved", refKind: "branch", commit };
  }
  const output = await runInstallCommand(
    "git",
    [
      "ls-remote",
      args.url,
      `refs/tags/${args.ref}`,
      `refs/tags/${args.ref}^{}`,
      `refs/heads/${args.ref}`,
    ],
    {
      notFoundHint:
        '"git" was not found on PATH — git plugin updates require git',
    },
  );
  const refs = parseLsRemote(output);
  const tag =
    refs.get(`refs/tags/${args.ref}^{}`) ?? refs.get(`refs/tags/${args.ref}`);
  if (tag !== undefined) {
    return { outcome: "resolved", refKind: "tag", commit: tag };
  }
  const branch = refs.get(`refs/heads/${args.ref}`);
  if (branch !== undefined) {
    return { outcome: "resolved", refKind: "branch", commit: branch };
  }
  return {
    outcome: "unavailable",
    detail: `git ref "${args.ref}" was not found in ${args.url}`,
  };
}

export function gitResolvedVersion(args: {
  url: string;
  ref: string;
  commit: string;
}): PluginResolvedUpdateVersion {
  return {
    version: args.commit,
    display: `${args.url}@${args.ref} (${args.commit.slice(0, 12)})`,
  };
}

export async function resolveGitUpdate(args: {
  url: string;
  ref: string;
  refKind: GitRefKind;
  currentCommit: string;
}): Promise<PluginUpdateResolution> {
  const current = gitResolvedVersion({
    url: args.url,
    ref: args.ref,
    commit: args.currentCommit,
  });
  if (args.refKind !== "branch") return { outcome: "pinned", current };
  const resolved = await resolveGitRef({ url: args.url, ref: args.ref });
  if (resolved.outcome === "unavailable") return resolved;
  const candidate = gitResolvedVersion({
    url: args.url,
    ref: args.ref,
    commit: resolved.commit,
  });
  if (resolved.commit === args.currentCommit) {
    return { outcome: "current", current };
  }
  return { outcome: "update-available", current, candidate };
}
