import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ExperimentalVcsProcessPriority } from "@get-bb/plugin-sdk/host";
import {
  type GitCommandResult,
  type GitTimeoutOptions,
  runGit,
  type RunGitOptions,
  trimOutput,
  WorkspaceError,
} from "bb-environment-provider-host/workspace-git";

const priorityStore = new AsyncLocalStorage<ExperimentalVcsProcessPriority>();

export function withGitPriority<T>(
  priority: ExperimentalVcsProcessPriority,
  operation: () => Promise<T>,
): Promise<T> {
  return priorityStore.run(priority, operation);
}

export function gitPriority(): ExperimentalVcsProcessPriority | undefined {
  return priorityStore.getStore();
}

export type GitNullRecordFormat =
  | "single"
  | "name-status"
  | "numstat"
  | "raw"
  | "raw-numstat";

export interface GitNullRecordLimitResult extends GitCommandResult {
  recordCount: number;
  recordLimitReached: boolean;
}

export async function runGitWithNullRecordLimit(
  args: string[],
  options: RunGitOptions,
  recordFormat: GitNullRecordFormat,
  maxRecords: number,
): Promise<GitNullRecordLimitResult> {
  if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
    throw new WorkspaceError(
      "invalid_request",
      "maxRecords must be a positive integer",
    );
  }
  const stdoutRecords: Buffer[] = [];
  let pending = Buffer.alloc(0);
  let currentRecord: Buffer[] = [];
  let expectedTokens = recordFormat === "single" ? 1 : 0;
  let currentRecordCounts = true;
  let recordCount = 0;
  let recordLimitReached = false;
  const onStdout = (chunk: Buffer): boolean => {
    const input =
      pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    let tokenStart = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] !== 0) continue;

      const token = Buffer.from(input.subarray(tokenStart, index));
      currentRecord.push(token);
      if (currentRecord.length === 1) {
        if (recordFormat === "name-status") {
          const statusLetter = token[0];
          expectedTokens = statusLetter === 82 || statusLetter === 67 ? 3 : 2;
        } else if (
          recordFormat === "raw" ||
          (recordFormat === "raw-numstat" && token[0] === 58)
        ) {
          const statusLetter = token[token.lastIndexOf(32) + 1];
          expectedTokens = statusLetter === 82 || statusLetter === 67 ? 3 : 2;
          currentRecordCounts = true;
        } else if (
          recordFormat === "numstat" ||
          recordFormat === "raw-numstat"
        ) {
          const firstTab = token.indexOf(9);
          const secondTab = token.indexOf(9, firstTab + 1);
          expectedTokens = secondTab === token.length - 1 ? 3 : 1;
          currentRecordCounts = recordFormat === "numstat";
        }
      }

      if (currentRecord.length === expectedTokens) {
        for (const recordToken of currentRecord) {
          stdoutRecords.push(recordToken, Buffer.from([0]));
        }
        currentRecord = [];
        expectedTokens = recordFormat === "single" ? 1 : 0;
        if (!currentRecordCounts) {
          currentRecordCounts = true;
          tokenStart = index + 1;
          continue;
        }
        recordCount += 1;
        if (recordCount === maxRecords) {
          recordLimitReached = true;
          pending = Buffer.alloc(0);
          return true;
        }
      }
      tokenStart = index + 1;
    }
    pending = Buffer.from(input.subarray(tokenStart));
    return false;
  };
  const result = await runGit(args, {
    ...options,
    priority: options.priority ?? gitPriority(),
    onStdout,
  });
  return {
    stdout: Buffer.concat(stdoutRecords).toString("utf8"),
    stderr: result.stderr,
    exitCode: recordLimitReached ? 0 : result.exitCode,
    recordCount,
    recordLimitReached,
  };
}

export function parsePatchId(line: string | undefined): string | undefined {
  const trimmed = line?.trim();
  if (!trimmed) {
    return undefined;
  }
  const [patchId] = trimmed.split(/\s+/);
  return patchId || undefined;
}

interface NameStatusEntry {
  path: string;
  status: string;
}

interface NameStatusSourceEntry extends NameStatusEntry {
  previousPath: string | null;
}

export function parseNameStatusSourceEntries(
  output: string,
): NameStatusSourceEntry[] {
  const tokens = output.split("\0");
  const entries: NameStatusSourceEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const statusToken = tokens[index];
    if (!statusToken) {
      index += 1;
      continue;
    }
    const statusLetter = statusToken[0] ?? "";
    const isRenameOrCopy = statusLetter === "R" || statusLetter === "C";
    if (isRenameOrCopy) {
      const oldPath = tokens[index + 1];
      const newPath = tokens[index + 2];
      if (newPath) {
        entries.push({
          path: newPath,
          status: statusLetter,
          previousPath: oldPath ?? null,
        });
      }
      index += 3;
    } else {
      const pathToken = tokens[index + 1];
      if (pathToken) {
        entries.push({
          path: pathToken,
          status: statusLetter,
          previousPath: null,
        });
      }
      index += 2;
    }
  }
  return entries;
}

export interface RawDiffEntry extends NameStatusSourceEntry {
  oldMode: string;
  newMode: string;
  oldBlob: string;
  newBlob: string;
}

export function parseRawDiffEntriesZ(output: string): RawDiffEntry[] {
  const tokens = output.split("\0");
  const entries: RawDiffEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const header = tokens[index];
    if (!header?.startsWith(":")) {
      index += 1;
      continue;
    }
    const [oldMode, newMode, oldBlob, newBlob, status] = header
      .slice(1)
      .split(" ");
    const statusLetter = status?.[0] ?? "";
    const isRenameOrCopy = statusLetter === "R" || statusLetter === "C";
    const previousPath = isRenameOrCopy ? (tokens[index + 1] ?? null) : null;
    const path = tokens[index + (isRenameOrCopy ? 2 : 1)];
    if (path && oldMode && newMode && oldBlob && newBlob) {
      entries.push({
        path,
        previousPath,
        status: statusLetter,
        oldMode,
        newMode,
        oldBlob,
        newBlob,
      });
    }
    index += isRenameOrCopy ? 3 : 2;
  }
  return entries;
}

export function parseNameStatusEntries(output: string): NameStatusEntry[] {
  return parseNameStatusSourceEntries(output).map(({ path, status }) => ({
    path,
    status,
  }));
}

export function summarizeNumstat(output: string): {
  changedFiles: number;
  insertions: number;
  deletions: number;
} {
  const lines = output.split("\n").filter(Boolean);

  return lines.reduce(
    (summary, line) => {
      const [insertionsText, deletionsText] = line.split("\t");
      const insertions = Number.parseInt(insertionsText ?? "", 10);
      const deletions = Number.parseInt(deletionsText ?? "", 10);

      return {
        changedFiles: summary.changedFiles + 1,
        insertions:
          summary.insertions + (Number.isFinite(insertions) ? insertions : 0),
        deletions:
          summary.deletions + (Number.isFinite(deletions) ? deletions : 0),
      };
    },
    { changedFiles: 0, insertions: 0, deletions: 0 },
  );
}

export interface NumstatEntry {
  path: string;
  insertions: number | null;
  deletions: number | null;
}

export function parseNumstatEntriesZ(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  let cursor = 0;
  while (cursor < output.length) {
    const firstTab = output.indexOf("\t", cursor);
    if (firstTab < 0) break;
    const secondTab = output.indexOf("\t", firstTab + 1);
    if (secondTab < 0) break;
    const insertions = parseNumstatCount(output.slice(cursor, firstTab));
    const deletions = parseNumstatCount(output.slice(firstTab + 1, secondTab));

    let path: string;
    if (output[secondTab + 1] === "\0") {
      const oldEnd = output.indexOf("\0", secondTab + 2);
      if (oldEnd < 0) break;
      const newEnd = output.indexOf("\0", oldEnd + 1);
      if (newEnd < 0) break;
      path = output.slice(oldEnd + 1, newEnd);
      cursor = newEnd + 1;
    } else {
      const end = output.indexOf("\0", secondTab + 1);
      if (end < 0) break;
      path = output.slice(secondTab + 1, end);
      cursor = end + 1;
    }
    entries.push({ path, insertions, deletions });
  }
  return entries;
}

function parseNumstatCount(text: string): number | null {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
}

export async function resolveMergeBaseBranch(
  cwd: string,
  ref: string,
  options: GitTimeoutOptions = {},
): Promise<string | undefined> {
  const candidates =
    ref.startsWith("refs/") || ref.startsWith("origin/")
      ? [ref]
      : [ref, `refs/remotes/origin/${ref}`];
  for (const candidate of candidates) {
    const result = await runGit(
      ["rev-parse", "--verify", "--end-of-options", `${candidate}^{commit}`],
      {
        cwd,
        ...options,
        priority: options.priority ?? gitPriority(),
        allowFailure: true,
      },
    );
    if (result.exitCode === 0 && trimOutput(result.stdout)) {
      return trimOutput(result.stdout);
    }
  }
  return undefined;
}

export async function readMergeBaseRef(
  cwd: string,
  ref: string,
  options: GitTimeoutOptions = {},
): Promise<string> {
  const revision = await resolveMergeBaseBranch(cwd, ref, options);
  if (revision) {
    const result = await runGit(["merge-base", revision, "HEAD"], {
      cwd,
      ...options,
      priority: options.priority ?? gitPriority(),
      allowFailure: true,
    });
    if (result.exitCode === 0 && trimOutput(result.stdout)) {
      return trimOutput(result.stdout);
    }
  }
  throw new WorkspaceError(
    "git_command_failed",
    `Could not resolve merge base for "${ref}" with HEAD. Ensure the branch or its origin remote-tracking ref exists and shares history with HEAD.`,
  );
}
