import type { BranchRef, FileChange, GitRef, GitRefKind } from "./schemas.js";

const RECORD_SEPARATOR = "\x1e";
const UNIT_SEPARATOR = "\x1f";
const REMOTE_HEAD_SUFFIX = "/HEAD";

export interface RawLogCommit {
  hash: string;
  abbrev: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
}

export function stripRecordSeparatorNewlines(record: string): string {
  return record.replace(/^[\r\n]+/u, "");
}

export function parseLogOutput(raw: string): RawLogCommit[] {
  const commits: RawLogCommit[] = [];
  for (const rawRecord of raw.split(RECORD_SEPARATOR)) {
    const record = stripRecordSeparatorNewlines(rawRecord);
    if (record.trim().length === 0) continue;
    const fields = record.split(UNIT_SEPARATOR);
    if (fields.length < 7) continue;
    const [
      hash,
      abbrev,
      parents,
      authorName,
      authorEmail,
      authorDate,
      subject,
    ] = fields;
    commits.push({
      hash,
      abbrev,
      parents: parents.length === 0 ? [] : parents.split(" ").filter(Boolean),
      authorName,
      authorEmail,
      authorDate,
      subject,
    });
  }
  return commits;
}

export interface RawRefRow {
  refName: string;
  commitHash: string;
  shortName: string;
}

export function parseForEachRefOutput(raw: string): RawRefRow[] {
  const rows: RawRefRow[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.split("\x1f");
    if (fields.length < 4) continue;
    const [refName, commitHash, dereferenced, shortName] = fields;
    if (!refName.startsWith("refs/")) continue;
    rows.push({
      refName,
      commitHash: dereferenced.length > 0 ? dereferenced : commitHash,
      shortName,
    });
  }
  return rows;
}

export function refKindForRefName(refName: string): GitRefKind {
  if (refName.startsWith("refs/heads/")) return "branch";
  if (refName.startsWith("refs/remotes/")) return "remote";
  if (refName.startsWith("refs/tags/")) return "tag";
  if (refName === "refs/stash") return "stash";
  return "other";
}

const REF_ORDER: Record<GitRefKind, number> = {
  branch: 0,
  remote: 1,
  tag: 2,
  stash: 3,
  other: 4,
};

export function buildRefsByCommit(
  rows: readonly RawRefRow[],
  headCommitHash: string | null,
  headRefName: string | null = null,
): Map<string, GitRef[]> {
  const byCommit = new Map<string, GitRef[]>();
  for (const row of rows) {
    const kind = refKindForRefName(row.refName);
    const existing = byCommit.get(row.commitHash) ?? [];
    existing.push({ name: row.shortName, kind, isHead: false });
    byCommit.set(row.commitHash, existing);
  }
  if (headCommitHash !== null) {
    const existing = byCommit.get(headCommitHash) ?? [];
    const branch =
      headRefName === null
        ? existing.find((ref) => ref.kind === "branch")
        : rows
            .filter((row) => row.refName === headRefName)
            .map((row) => existing.find((ref) => ref.name === row.shortName))
            .find((ref) => ref !== undefined);
    if (branch !== undefined) {
      branch.isHead = true;
    } else {
      existing.unshift({
        name: "HEAD",
        kind: "other",
        isHead: true,
      });
    }
    byCommit.set(headCommitHash, existing);
  }
  for (const [hash, refs] of byCommit) {
    refs.sort((a, b) => {
      if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
      const byKind = REF_ORDER[a.kind] - REF_ORDER[b.kind];
      if (byKind !== 0) return byKind;
      return a.name.localeCompare(b.name);
    });
    byCommit.set(hash, refs);
  }
  return byCommit;
}

export function isRemoteHeadAlias(refName: string): boolean {
  return (
    refName.startsWith("refs/remotes/") && refName.endsWith(REMOTE_HEAD_SUFFIX)
  );
}

export function listBranchRefs(
  rows: readonly RawRefRow[],
  headCommitHash: string | null,
  headRefName: string | null = null,
): BranchRef[] {
  const byFullName = new Map<string, BranchRef>();
  for (const row of rows) {
    const isRemote = row.refName.startsWith("refs/remotes/");
    if (!isRemote && !row.refName.startsWith("refs/heads/")) continue;
    if (isRemote && isRemoteHeadAlias(row.refName)) continue;
    if (byFullName.has(row.refName)) continue;
    byFullName.set(row.refName, {
      fullName: row.refName,
      shortName: row.shortName,
      isRemote,
      isHead:
        !isRemote &&
        (headRefName !== null
          ? row.refName === headRefName
          : headCommitHash !== null && row.commitHash === headCommitHash),
    });
  }
  const branches = [...byFullName.values()];
  branches.sort((a, b) => {
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
    return a.shortName.localeCompare(b.shortName);
  });
  return branches;
}

export interface DirtySummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  total: number;
  truncated: boolean;
}

export const STATUS_ENTRY_CAP = 2_000;

function isConflictPair(x: string, y: string): boolean {
  return (
    x === "U" ||
    y === "U" ||
    (x === "A" && y === "A") ||
    (x === "D" && y === "D")
  );
}

export function parseStatusPorcelain(
  raw: string,
  cap = STATUS_ENTRY_CAP,
): DirtySummary {
  const summary: DirtySummary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    total: 0,
    truncated: false,
  };
  const entries = raw.split("\0");
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    index += 1;
    if (entry.length === 0) continue;
    if (entry.length < 4) continue;
    if (summary.total >= cap) {
      summary.truncated = true;
      break;
    }
    const xy = entry.slice(0, 2);
    const x = xy[0];
    const y = xy[1];
    summary.total += 1;
    if (xy === "??") {
      summary.untracked += 1;
    } else if (isConflictPair(x, y)) {
      summary.conflicted += 1;
    } else {
      if (x !== " ") summary.staged += 1;
      if (y !== " ") summary.unstaged += 1;
    }
    const statusLetter = xy[0];
    if (statusLetter === "R" || statusLetter === "C") {
      index += 1;
    }
  }
  return summary;
}

const NAME_STATUS_MAP: Record<string, FileChange["status"]> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-change",
  U: "unmerged",
  X: "unmerged",
};

function statusFromNameStatus(letter: string): FileChange["status"] {
  const mapped = NAME_STATUS_MAP[letter];
  return mapped ?? "unknown";
}

export function parseNameStatus(raw: string): FileChange[] {
  const changes: FileChange[] = [];
  const tokens = raw.split("\0");
  let index = 0;
  while (index < tokens.length) {
    const statusToken = tokens[index];
    index += 1;
    if (statusToken.length === 0) continue;
    const letter = statusToken[0];
    const status = statusFromNameStatus(letter);
    const path = tokens[index];
    index += 1;
    if (path === undefined || path.length === 0) continue;
    let oldPath: string | null = null;
    if (status === "renamed" || status === "copied") {
      const origin = tokens[index];
      index += 1;
      if (origin !== undefined && origin.length > 0) oldPath = origin;
    }
    changes.push({ path, status, oldPath });
  }
  return changes;
}

const UNBORN_HEAD_PATTERNS = [
  /does not have any commits yet/iu,
  /unknown revision or path not in the working tree/iu,
  /bad revision/iu,
  /ambiguous argument 'head'/iu,
];

export function isUnbornHeadMessage(message: string): boolean {
  return UNBORN_HEAD_PATTERNS.some((pattern) => pattern.test(message));
}

export function describeGitFailure(
  args: readonly string[],
  result: { exitCode: number; stderr: string },
): string {
  const detail = result.stderr.trim().split("\n").slice(0, 3).join(" ").trim();
  const command = args.slice(0, 4).join(" ");
  return `git ${command} failed (${result.exitCode}): ${detail || "no stderr output"}`;
}
