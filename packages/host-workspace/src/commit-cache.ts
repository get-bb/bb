import { ByteBudgetCache } from "./byte-budget-cache.js";
import {
  parsePatchId,
  parseRawDiffEntriesZ,
  type GitCommandResult,
  type RawDiffEntry,
} from "./git.js";

export type CommitGitRunner = (
  args: string[],
  options?: { input?: string; maxBufferBytes?: number },
) => Promise<GitCommandResult>;

const COMMIT_CHANGES_CACHE_BYTES = 64 * 1024 * 1024;
const COMMIT_CHANGES_MAX_ENTRY_BYTES = 1024 * 1024;
const PATCH_ID_CACHE_BYTES = 8 * 1024 * 1024;
const CACHE_ENTRY_OVERHEAD_BYTES = 64;
const COMMIT_CHANGES_BATCH_SIZE = 256;
const COMMIT_CHANGES_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const EQUIVALENCE_MAX_PATCH_BYTES = 256 * 1024 * 1024;
const COMMIT_LOG_ARGS = [
  "--no-walk=unsorted",
  "--stdin",
  "--no-ext-diff",
  "--no-textconv",
  "--no-show-signature",
];

type PatchIdMode = "cherry-pick" | "squash";

const commitChanges = new ByteBudgetCache<string>(
  COMMIT_CHANGES_CACHE_BYTES,
  COMMIT_CHANGES_MAX_ENTRY_BYTES,
);
const patchIdCaches: Record<PatchIdMode, ByteBudgetCache<string | null>> = {
  "cherry-pick": new ByteBudgetCache(PATCH_ID_CACHE_BYTES),
  squash: new ByteBudgetCache(PATCH_ID_CACHE_BYTES),
};
const patchRenameArgs: Record<PatchIdMode, string[]> = {
  "cherry-pick": ["--no-renames"],
  squash: [],
};

function rememberPatchId(
  cache: ByteBudgetCache<string | null>,
  key: string,
  patchId: string | null,
): void {
  cache.set(
    key,
    patchId,
    key.length + (patchId?.length ?? 0) + CACHE_ENTRY_OVERHEAD_BYTES,
  );
}

function changedPathKey(entries: RawDiffEntry[]): string {
  return entries
    .map((entry) => entry.path.replace(/\s/gu, ""))
    .sort()
    .join("\0");
}

export async function readCommitChanges(
  run: CommitGitRunner,
  commits: string[],
): Promise<Map<string, RawDiffEntry[]> | null> {
  const changes = new Map<string, RawDiffEntry[]>();
  const missing: string[] = [];
  for (const commit of commits) {
    const cached = commitChanges.get(commit);
    if (cached === undefined) missing.push(commit);
    else changes.set(commit, parseRawDiffEntriesZ(cached));
  }
  for (let start = 0; start < missing.length; start += COMMIT_CHANGES_BATCH_SIZE) {
    const batch = missing.slice(start, start + COMMIT_CHANGES_BATCH_SIZE);
    const log = await run(
      [
        "log",
        ...COMMIT_LOG_ARGS,
        "--no-renames",
        "--raw",
        "-z",
        "--no-abbrev",
        "--format=%x00%x00%H",
      ],
      {
        input: `${batch.join("\n")}\n`,
        maxBufferBytes: COMMIT_CHANGES_MAX_BUFFER_BYTES,
      },
    );
    if (log.exitCode !== 0) return null;
    const blocks = log.stdout.split(/\0\0([a-f0-9]{40,64})\0/u);
    if (blocks[0] !== "" || blocks.length % 2 !== 1) return null;
    for (let i = 1; i < blocks.length; i += 2) {
      const raw = blocks[i + 1].replace(/^\n/u, "");
      commitChanges.set(
        blocks[i],
        raw,
        blocks[i].length + raw.length + CACHE_ENTRY_OVERHEAD_BYTES,
      );
      changes.set(blocks[i], parseRawDiffEntriesZ(raw));
    }
    for (const commit of batch) {
      if (!changes.has(commit)) return null;
    }
  }
  return changes;
}

export async function readCommitPatchIds(
  run: CommitGitRunner,
  mode: PatchIdMode,
  commits: string[],
  maxPatchBytes: number,
): Promise<{ patchIds: Map<string, string | null>; patchBytes: number } | null> {
  const cache = patchIdCaches[mode];
  const patchIds = new Map<string, string | null>();
  const missing: string[] = [];
  for (const commit of commits) {
    const cached = cache.get(commit);
    if (cached !== undefined) patchIds.set(commit, cached);
    else missing.push(commit);
  }
  if (missing.length === 0) return { patchIds, patchBytes: 0 };
  if (maxPatchBytes <= 0) return null;
  const patch = await run(
    [
      "log",
      ...COMMIT_LOG_ARGS,
      ...patchRenameArgs[mode],
      "-p",
      "--format=commit %H",
    ],
    { input: `${missing.join("\n")}\n`, maxBufferBytes: maxPatchBytes },
  );
  if (patch.exitCode !== 0) return null;
  const hashed = await run(["patch-id", "--stable"], { input: patch.stdout });
  if (hashed.exitCode !== 0) return null;
  const found = new Map<string, string>();
  for (const line of hashed.stdout.split("\n")) {
    const [patchId, commit] = line.trim().split(/\s+/u);
    if (patchId && commit) found.set(commit, patchId);
  }
  for (const commit of missing) {
    const patchId = found.get(commit) ?? null;
    rememberPatchId(cache, commit, patchId);
    patchIds.set(commit, patchId);
  }
  return { patchIds, patchBytes: Buffer.byteLength(patch.stdout) };
}

export async function readSquashRangePatchId(
  run: CommitGitRunner,
  from: string,
  to: string,
  maxPatchBytes: number,
): Promise<{ patchId: string | null; patchBytes: number } | null> {
  const cache = patchIdCaches.squash;
  const key = `${from}..${to}`;
  const cached = cache.get(key);
  if (cached !== undefined) return { patchId: cached, patchBytes: 0 };
  if (maxPatchBytes <= 0) return null;
  const patch = await run(
    ["diff", "--no-ext-diff", "--no-textconv", from, to],
    { maxBufferBytes: maxPatchBytes },
  );
  if (patch.exitCode !== 0) return null;
  const hashed = await run(["patch-id", "--stable"], { input: patch.stdout });
  if (hashed.exitCode !== 0) return null;
  const patchId = parsePatchId(hashed.stdout.split("\n")[0]) ?? null;
  rememberPatchId(cache, key, patchId);
  return { patchId, patchBytes: Buffer.byteLength(patch.stdout) };
}

export async function readPatchEquivalentCommits(
  run: CommitGitRunner,
  left: string[],
  right: string[],
): Promise<Set<string> | null> {
  if (left.length === 0 || right.length === 0) return new Set();
  const changes = await readCommitChanges(run, [...left, ...right]);
  if (!changes) return null;
  const keysFor = (commits: string[]): Map<string, string> => {
    const keys = new Map<string, string>();
    for (const commit of commits) {
      const key = changedPathKey(changes.get(commit) ?? []);
      if (key !== "") keys.set(commit, key);
    }
    return keys;
  };
  const leftKeys = keysFor(left);
  const rightKeys = keysFor(right);
  const leftKeySet = new Set(leftKeys.values());
  const rightKeySet = new Set(rightKeys.values());
  const leftCandidates = [...leftKeys.keys()].filter((commit) =>
    rightKeySet.has(leftKeys.get(commit) ?? ""),
  );
  const rightCandidates = [...rightKeys.keys()].filter((commit) =>
    leftKeySet.has(rightKeys.get(commit) ?? ""),
  );
  if (leftCandidates.length === 0) return new Set();
  const hashed = await readCommitPatchIds(
    run,
    "cherry-pick",
    [...leftCandidates, ...rightCandidates],
    EQUIVALENCE_MAX_PATCH_BYTES,
  );
  if (!hashed) return null;
  const idsFor = (commits: string[]) =>
    new Set(commits.map((commit) => hashed.patchIds.get(commit)));
  const leftIds = idsFor(leftCandidates);
  const rightIds = idsFor(rightCandidates);
  return new Set(
    [...leftCandidates, ...rightCandidates].filter((commit) => {
      const patchId = hashed.patchIds.get(commit);
      return patchId != null && leftIds.has(patchId) && rightIds.has(patchId);
    }),
  );
}
