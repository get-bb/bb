import path from "node:path";
import type {
  BranchRef,
  FileChange,
  GitRef,
  HistoryCommit,
  RepoSummary,
} from "./schemas.js";
import {
  DEFAULT_SCAN_LIMITS,
  scanDirectoryTree,
  toForwardSlashes,
  type DiscoveredRepo,
  type FsReader,
  type ScanLimits,
} from "./discovery.js";
import {
  buildRefsByCommit,
  describeGitFailure,
  isRemoteHeadAlias,
  isUnbornHeadMessage,
  listBranchRefs,
  parseForEachRefOutput,
  parseLogOutput,
  parseNameStatus,
  parseStatusPorcelain,
  stripRecordSeparatorNewlines,
  type DirtySummary,
} from "./parse.js";
import type { GitRunner } from "./run.js";

const LOG_FIELD_FORMAT = ["%H", "%h", "%P", "%an", "%ae", "%ad", "%s"].join(
  "\x1f",
);
const LOG_RECORD_SUFFIX = "\x1e";
const DETAIL_FIELD_FORMAT = [
  "%H",
  "%h",
  "%T",
  "%P",
  "%an",
  "%ae",
  "%ad",
  "%cn",
  "%ce",
  "%cd",
  "%B",
].join("\x1f");
const PARENT_SUBJECT_FORMAT = ["%H", "%h", "%s"].join("\x1f");
const FOR_EACH_REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(*objectname)",
  "%(refname:short)",
].join("\x1f");
const PATCH_BYTE_CAP = 1_000_000;

export interface ServiceDeps {
  runGit: GitRunner;
  fs: FsReader;
  scanLimits?: ScanLimits;
}

export class GitRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitRepoError";
  }
}

export interface RepoScanOutcome {
  sourceRoot: string;
  repos: RepoSummary[];
  scanTruncated: boolean;
  scanError: string | null;
}

export interface RepoStatusData {
  dirty: DirtySummary | null;
  branches: BranchRef[];
  branchCount: number;
  tagCount: number;
  remoteRefCount: number;
  error: string | null;
}

export interface HistoryPage {
  commits: HistoryCommit[];
  empty: boolean;
}

export interface CommitDetailData {
  commit: {
    hash: string;
    abbrev: string;
    tree: string;
    parents: Array<{ hash: string; abbrev: string; subject: string }>;
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
    message: string;
    refs: GitRef[];
    isMerge: boolean;
    isRoot: boolean;
  };
  files: FileChange[];
  filesNote: string | null;
}

function repoArgs(repoAbsPath: string, args: readonly string[]): string[] {
  return [
    "-C",
    repoAbsPath,
    "-c",
    "core.quotepath=false",
    "-c",
    "core.fsmonitor=false",
    ...args,
  ];
}

async function runOrThrow(
  runGit: GitRunner,
  repoAbsPath: string,
  args: readonly string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number },
): Promise<string> {
  const result = await runGit(repoArgs(repoAbsPath, args), options);
  if (result.exitCode !== 0) {
    throw new GitRepoError(describeGitFailure(args, result));
  }
  return result.stdout;
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0]?.trim() ?? "";
}

export function repoAbsolutePath(
  sourceRoot: string,
  repoRelPath: string,
): string {
  return path.resolve(sourceRoot, repoRelPath);
}

export function enclosingRelPath(
  sourceRoot: string,
  toplevel: string,
): string | null {
  const rel = path.relative(sourceRoot, toplevel);
  if (rel.length === 0) return "";
  const normalized = toForwardSlashes(rel);
  if (!normalized.startsWith("..")) return normalized;
  return normalized;
}

type RepoPosition = "root" | "nested" | "enclosing";

interface RepoCandidate extends Pick<DiscoveredRepo, "relPath" | "gitLink"> {
  position: RepoPosition;
  repoAbsPath: string;
}

interface HeadInfo {
  head: RepoSummary["head"];
  empty: boolean;
  error: string | null;
}

async function readHeadInfo(
  runGit: GitRunner,
  repoAbsPath: string,
): Promise<HeadInfo> {
  const headResult = await runGit(repoArgs(repoAbsPath, ["rev-parse", "HEAD"]));
  if (headResult.exitCode !== 0) {
    if (isUnbornHeadMessage(headResult.stderr)) {
      return { head: null, empty: true, error: null };
    }
    return {
      head: null,
      empty: false,
      error: describeGitFailure(["rev-parse"], headResult),
    };
  }
  const hash = firstLine(headResult.stdout);
  const abbrevResult = await runGit(
    repoArgs(repoAbsPath, ["show", "-s", "--format=%h", hash]),
    { timeoutMs: 10_000 },
  );
  const branchResult = await runGit(
    repoArgs(repoAbsPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    { timeoutMs: 10_000 },
  );
  const branch =
    branchResult.exitCode === 0 ? firstLine(branchResult.stdout) : null;
  return {
    head: {
      abbrev:
        abbrevResult.exitCode === 0 ? firstLine(abbrevResult.stdout) : hash,
      branch,
      detached: branch === null,
    },
    empty: false,
    error: null,
  };
}

async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  worker: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index]!);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

export function createGitGraphService(deps: ServiceDeps) {
  const { runGit, fs } = deps;
  const scanLimits = deps.scanLimits ?? DEFAULT_SCAN_LIMITS;

  async function scanProjectRepos(
    sourceRoot: string,
  ): Promise<RepoScanOutcome> {
    const repos: RepoSummary[] = [];
    let scanTruncated = false;
    let scanError: string | null = null;
    const rootStat = await fs.stat(sourceRoot);
    if (rootStat === null || !rootStat.isDirectory) {
      return {
        sourceRoot: sourceRoot,
        repos: [],
        scanTruncated: false,
        scanError: `Project folder is not accessible on this machine: ${sourceRoot}`,
      };
    }
    const scan = await scanDirectoryTree(sourceRoot, fs, scanLimits);
    scanTruncated = scan.truncated;
    const candidates: RepoCandidate[] = scan.repos.map((repo) => ({
      ...repo,
      repoAbsPath: path.resolve(sourceRoot, repo.relPath),
    }));
    if (!scan.rootIsRepo) {
      const toplevelResult = await runGit(
        repoArgs(sourceRoot, ["rev-parse", "--show-toplevel"]),
        { timeoutMs: 10_000 },
      );
      if (toplevelResult.exitCode === 0) {
        const toplevel = firstLine(toplevelResult.stdout);
        const rel = enclosingRelPath(sourceRoot, toplevel);
        if (rel !== null && rel.length > 0 && rel.startsWith("..")) {
          const dotGitStat = await fs.stat(`${toplevel}/.git`);
          const gitLink: DiscoveredRepo["gitLink"] =
            dotGitStat?.isDirectory === true ? "direct" : "worktree";
          candidates.push({
            relPath: rel,
            position: "enclosing",
            gitLink,
            repoAbsPath: path.resolve(toplevel),
          });
        }
      }
    }
    const summaries = await mapWithConcurrency(candidates, 6, async (repo) => {
      try {
        const head = await readHeadInfo(runGit, repo.repoAbsPath);
        return {
          relPath: repo.relPath,
          position: repo.position,
          gitLink: repo.gitLink,
          head: head.head,
          empty: head.empty,
          error: head.error,
        } satisfies RepoSummary;
      } catch (error) {
        return {
          relPath: repo.relPath,
          position: repo.position,
          gitLink: repo.gitLink,
          head: null,
          empty: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies RepoSummary;
      }
    });
    repos.push(...summaries);
    repos.sort((a, b) => {
      if (a.position !== b.position) {
        const order = { root: 0, enclosing: 1, nested: 2 } as const;
        return order[a.position] - order[b.position];
      }
      const depthA = a.relPath.split("/").length;
      const depthB = b.relPath.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return a.relPath.localeCompare(b.relPath);
    });
    return { sourceRoot: sourceRoot, repos, scanTruncated, scanError };
  }

  async function repoStatus(repoAbsPath: string): Promise<RepoStatusData> {
    const [statusResult, refsResult, headProbe, headRefProbe] =
      await Promise.all([
        runGit(repoArgs(repoAbsPath, ["status", "--porcelain=v1", "-z"]), {
          timeoutMs: 15_000,
          maxOutputBytes: 4 * 1024 * 1024,
        }),
        runGit(
          repoArgs(repoAbsPath, [
            "for-each-ref",
            `--format=${FOR_EACH_REF_FORMAT}`,
          ]),
          { timeoutMs: 10_000 },
        ),
        runGit(repoArgs(repoAbsPath, ["rev-parse", "HEAD"]), {
          timeoutMs: 10_000,
        }),
        runGit(repoArgs(repoAbsPath, ["symbolic-ref", "--quiet", "HEAD"]), {
          timeoutMs: 10_000,
        }),
      ]);
    if (statusResult.exitCode !== 0) {
      return {
        dirty: null,
        branches: [],
        branchCount: 0,
        tagCount: 0,
        remoteRefCount: 0,
        error: describeGitFailure(["status"], statusResult),
      };
    }
    const refRows = refsResult.exitCode
      ? []
      : parseForEachRefOutput(refsResult.stdout);
    let tagCount = 0;
    let remoteRefCount = 0;
    for (const row of refRows) {
      if (row.refName.startsWith("refs/tags/")) {
        tagCount += 1;
      } else if (
        row.refName.startsWith("refs/remotes/") &&
        !isRemoteHeadAlias(row.refName)
      ) {
        remoteRefCount += 1;
      }
    }
    const headHash =
      headProbe.exitCode === 0 ? firstLine(headProbe.stdout) : null;
    const headRefName =
      headRefProbe.exitCode === 0 ? firstLine(headRefProbe.stdout) : null;
    return {
      dirty: parseStatusPorcelain(statusResult.stdout),
      branches: listBranchRefs(refRows, headHash, headRefName),
      branchCount: refRows.filter((row) =>
        row.refName.startsWith("refs/heads/"),
      ).length,
      tagCount,
      remoteRefCount,
      error: null,
    };
  }

  async function history(
    repoAbsPath: string,
    input: {
      offset: number;
      limit: number;
      query?: string;
      refs: readonly string[];
      includeRemotes: boolean;
    },
  ): Promise<HistoryPage> {
    const args = ["log"];
    if (input.refs.length > 0) {
      args.push(...input.refs);
    } else {
      args.push("HEAD", "--branches");
      if (input.includeRemotes) {
        args.push("--remotes");
      }
    }
    args.push(
      "--date-order",
      "--date=iso-strict",
      `--skip=${input.offset}`,
      "-n",
      String(input.limit),
      `--format=${LOG_FIELD_FORMAT}${LOG_RECORD_SUFFIX}`,
    );
    const query = input.query?.trim() ?? "";
    if (query.length > 0) {
      args.push("--regexp-ignore-case", "--grep", query);
    }
    const logResult = await runGit(repoArgs(repoAbsPath, args), {
      timeoutMs: 30_000,
      maxOutputBytes: 8 * 1024 * 1024,
    });
    if (logResult.exitCode !== 0) {
      if (isUnbornHeadMessage(logResult.stderr)) {
        return { commits: [], empty: true };
      }
      throw new GitRepoError(describeGitFailure(["log"], logResult));
    }
    const rawCommits = parseLogOutput(logResult.stdout);
    if (rawCommits.length === 0) {
      if (input.offset === 0) {
        const probe = await runGit(
          repoArgs(repoAbsPath, ["rev-parse", "--verify", "--quiet", "HEAD"]),
          { timeoutMs: 10_000 },
        );
        return { commits: [], empty: probe.exitCode !== 0 };
      }
      return { commits: [], empty: false };
    }
    const [headResult, headRefResult, refsResult] = await Promise.all([
      runGit(repoArgs(repoAbsPath, ["rev-parse", "HEAD"]), {
        timeoutMs: 10_000,
      }),
      runGit(repoArgs(repoAbsPath, ["symbolic-ref", "--quiet", "HEAD"]), {
        timeoutMs: 10_000,
      }),
      runGit(
        repoArgs(repoAbsPath, [
          "for-each-ref",
          `--format=${FOR_EACH_REF_FORMAT}`,
        ]),
        { timeoutMs: 15_000 },
      ),
    ]);
    const headHash =
      headResult.exitCode === 0 ? firstLine(headResult.stdout) : null;
    const headRefName =
      headRefResult.exitCode === 0 ? firstLine(headRefResult.stdout) : null;
    const refRows = refsResult.exitCode
      ? []
      : parseForEachRefOutput(refsResult.stdout).filter(
          (row) =>
            !isRemoteHeadAlias(row.refName) &&
            (input.includeRemotes || !row.refName.startsWith("refs/remotes/")),
        );
    const refsByCommit = buildRefsByCommit(refRows, headHash, headRefName);
    const commits: HistoryCommit[] = rawCommits.map((raw) => ({
      hash: raw.hash,
      abbrev: raw.abbrev,
      parents: raw.parents,
      subject: raw.subject,
      authorName: raw.authorName,
      authorEmail: raw.authorEmail,
      authorDate: raw.authorDate,
      refs: refsByCommit.get(raw.hash) ?? [],
    }));
    return { commits, empty: false };
  }

  async function commitDetail(
    repoAbsPath: string,
    hash: string,
  ): Promise<CommitDetailData> {
    const detailRaw = await runOrThrow(runGit, repoAbsPath, [
      "show",
      "-s",
      `--format=${DETAIL_FIELD_FORMAT}${LOG_RECORD_SUFFIX}`,
      hash,
    ]);
    const record = stripRecordSeparatorNewlines(
      detailRaw.split("\x1e")[0] ?? "",
    );
    const fields = record.split("\x1f");
    if (fields.length < 11) {
      throw new GitRepoError(
        `git show returned a malformed record for ${hash}`,
      );
    }
    const [
      fullHash,
      abbrev,
      tree,
      parentsRaw,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      committerDate,
      message,
    ] = fields;
    const parents =
      parentsRaw.length === 0 ? [] : parentsRaw.split(" ").filter(Boolean);
    const parentSubjects: Array<{
      hash: string;
      abbrev: string;
      subject: string;
    }> = [];
    if (parents.length > 0) {
      const parentRaw = await runOrThrow(runGit, repoAbsPath, [
        "show",
        "-s",
        `--format=${PARENT_SUBJECT_FORMAT}${LOG_RECORD_SUFFIX}`,
        ...parents,
      ]);
      for (const rawParentRecord of parentRaw.split("\x1e")) {
        const parentFields =
          stripRecordSeparatorNewlines(rawParentRecord).split("\x1f");
        if (parentFields.length < 3) continue;
        parentSubjects.push({
          hash: parentFields[0] ?? "",
          abbrev: parentFields[1] ?? "",
          subject: parentFields[2] ?? "",
        });
      }
    }
    const headResult = await runGit(
      repoArgs(repoAbsPath, ["rev-parse", "HEAD"]),
      {
        timeoutMs: 10_000,
      },
    );
    const refsResult = await runGit(
      repoArgs(repoAbsPath, [
        "for-each-ref",
        `--format=${FOR_EACH_REF_FORMAT}`,
      ]),
      { timeoutMs: 15_000 },
    );
    const headHash =
      headResult.exitCode === 0 ? firstLine(headResult.stdout) : null;
    const refsByCommit = buildRefsByCommit(
      refsResult.exitCode === 0 ? parseForEachRefOutput(refsResult.stdout) : [],
      headHash,
    );
    const files = await commitFiles(repoAbsPath, fullHash ?? hash, parents);
    return {
      commit: {
        hash: fullHash ?? hash,
        abbrev: abbrev ?? hash,
        tree: tree ?? "",
        parents: parentSubjects,
        author: {
          name: authorName ?? "",
          email: authorEmail ?? "",
          date: authorDate ?? "",
        },
        committer: {
          name: committerName ?? "",
          email: committerEmail ?? "",
          date: committerDate ?? "",
        },
        message: (message ?? "").replace(/\n+$/u, ""),
        refs: refsByCommit.get(fullHash ?? hash) ?? [],
        isMerge: parents.length > 1,
        isRoot: parents.length === 0,
      },
      files: files.files,
      filesNote: files.note,
    };
  }

  async function commitFiles(
    repoAbsPath: string,
    hash: string,
    parents: readonly string[],
  ): Promise<{ files: FileChange[]; note: string | null }> {
    const args =
      parents.length === 0
        ? [
            "diff-tree",
            "--root",
            "-r",
            "-z",
            "--no-commit-id",
            "--name-status",
            hash,
          ]
        : [
            "diff-tree",
            "-r",
            "-z",
            "--no-commit-id",
            "--name-status",
            parents[0]!,
            hash,
          ];
    const result = await runGit(repoArgs(repoAbsPath, args), {
      timeoutMs: 20_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (result.exitCode !== 0) {
      return {
        files: [],
        note: describeGitFailure(["diff-tree"], result),
      };
    }
    return {
      files: parseNameStatus(result.stdout),
      note: parents.length > 1 ? "Compared against the first parent." : null,
    };
  }

  async function filePatch(
    repoAbsPath: string,
    hash: string,
    filePath: string,
  ): Promise<{ patch: string; truncated: boolean }> {
    const parentsResult = await runGit(
      repoArgs(repoAbsPath, ["show", "-s", "--format=%P", hash]),
      { timeoutMs: 10_000 },
    );
    if (parentsResult.exitCode !== 0) {
      throw new GitRepoError(describeGitFailure(["show"], parentsResult));
    }
    const firstParent = firstLine(parentsResult.stdout).split(" ")[0] ?? "";
    const args =
      firstParent.length === 0
        ? [
            "diff-tree",
            "-p",
            "--full-index",
            "--no-ext-diff",
            "--no-textconv",
            "--root",
            hash,
            "--",
            filePath,
          ]
        : [
            "diff-tree",
            "-p",
            "--full-index",
            "--no-ext-diff",
            "--no-textconv",
            firstParent,
            hash,
            "--",
            filePath,
          ];
    const result = await runGit(repoArgs(repoAbsPath, args), {
      timeoutMs: 30_000,
      maxOutputBytes: PATCH_BYTE_CAP * 2,
    });
    if (result.exitCode !== 0) {
      throw new GitRepoError(describeGitFailure(["diff-tree"], result));
    }
    const patch = result.stdout;
    if (patch.length > PATCH_BYTE_CAP) {
      return { patch: patch.slice(0, PATCH_BYTE_CAP), truncated: true };
    }
    return { patch, truncated: false };
  }

  return {
    scanProjectRepos,
    repoStatus,
    history,
    commitDetail,
    filePatch,
  };
}

export type GitGraphService = ReturnType<typeof createGitGraphService>;
