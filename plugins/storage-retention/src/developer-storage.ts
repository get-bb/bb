import { experimental_killProcessesWithCwdUnder } from "@get-bb/plugin-sdk/host";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isFsErrorWithCode } from "./fs-errors.js";
import type { hostStorageContract } from "./host-contract.js";

const launchRecordSchema = z.object({ repoRoot: z.string().min(1) });
const runtimeRecordSchema = z.object({ entryPath: z.string().min(1) });

async function readRecord(file: string) {
  try {
    const handle = await fs.open(file, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > 64 * 1024) return null;
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return JSON.parse(
        buffer.subarray(0, bytesRead).toString("utf8"),
      ) as unknown;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      isFsErrorWithCode(error, "ENOENT") ||
      isFsErrorWithCode(error, "ENOTDIR") ||
      isFsErrorWithCode(error, "EACCES") ||
      isFsErrorWithCode(error, "EPERM")
    )
      return null;
    throw error;
  }
}

function instanceName(sourcePath: string, homeDirectory: string) {
  const relative = path.relative(homeDirectory, sourcePath);
  const label =
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
      ? relative
      : sourcePath;
  const sanitized =
    label
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[._-]+|[._-]+$/gu, "") || "worktree";
  return `${sanitized}-${createHash("sha256").update(sourcePath).digest("hex").slice(0, 12)}`;
}

function inferredPaths(name: string, homeDirectory: string) {
  const label = name.replace(/-[a-f0-9]{12}$/, "");
  const managed =
    /^bb-plugins-environment-git-worktree-host-data-worktrees-(.+)-bb$/.exec(
      label,
    );
  const legacy = /^bb-worktrees-(.+)-bb$/.exec(label);
  const temporary = /^(private-tmp|tmp)-(.+)$/.exec(label);
  return [
    ...(managed
      ? [
          path.join(
            homeDirectory,
            ".bb",
            "plugins",
            "environment-git-worktree",
            "host-data",
            "worktrees",
            managed[1]!,
            "bb",
          ),
        ]
      : []),
    ...(legacy
      ? [path.join(homeDirectory, ".bb", "worktrees", legacy[1]!, "bb")]
      : []),
    ...(temporary && process.platform !== "win32"
      ? [
          path.join(
            temporary[1] === "private-tmp" ? "/private/tmp" : "/tmp",
            temporary[2]!,
          ),
        ]
      : []),
  ];
}

const DAEMON_LOCK_FRESH_MS = 15_000;

async function daemonRunning(directory: string) {
  try {
    const stats = await fs.stat(path.join(directory, "daemon.lock.lock"));
    return Date.now() - stats.mtimeMs < DAEMON_LOCK_FRESH_MS;
  } catch (error) {
    if (
      isFsErrorWithCode(error, "ENOENT") ||
      isFsErrorWithCode(error, "ENOTDIR") ||
      isFsErrorWithCode(error, "EACCES") ||
      isFsErrorWithCode(error, "EPERM")
    )
      return false;
    throw error;
  }
}

function assertDeveloperInput(
  input: z.infer<typeof hostStorageContract.inspectDeveloperEntries.input>,
) {
  if (
    !path.isAbsolute(input.rootPath) ||
    input.names.some(
      (name) => name === "." || name === ".." || /[\\/\0]/.test(name),
    ) ||
    input.candidatePaths.some((candidate) => !path.isAbsolute(candidate))
  )
    throw new Error("Invalid developer storage path");
}

export async function inspectDeveloperEntries(
  input: z.infer<typeof hostStorageContract.inspectDeveloperEntries.input>,
  signal: AbortSignal,
) {
  assertDeveloperInput(input);
  const homeDirectory = path.dirname(input.rootPath);
  const candidates = new Map(
    input.candidatePaths.map((candidate) => [
      instanceName(candidate, homeDirectory),
      candidate,
    ]),
  );
  const entries = [];
  for (const name of input.names) {
    signal.throwIfAborted();
    const directory = path.join(input.rootPath, name);
    const launch = launchRecordSchema.safeParse(
      await readRecord(path.join(directory, "bb-dev-instance.json")),
    );
    const runtime = runtimeRecordSchema.safeParse(
      await readRecord(path.join(directory, "bb-app-runtime.json")),
    );
    let sourcePath =
      launch.success && path.isAbsolute(launch.data.repoRoot)
        ? launch.data.repoRoot
        : null;
    if (
      sourcePath === null &&
      runtime.success &&
      path.isAbsolute(runtime.data.entryPath) &&
      path.basename(runtime.data.entryPath) === "start-bb.mjs" &&
      path.basename(path.dirname(runtime.data.entryPath)) === "scripts"
    )
      sourcePath = path.dirname(path.dirname(runtime.data.entryPath));
    sourcePath ??=
      candidates.get(name) ??
      inferredPaths(name, homeDirectory).find(
        (candidate) => instanceName(candidate, homeDirectory) === name,
      ) ??
      null;
    let sourcePathState: "exists" | "missing" | "unknown" = "unknown";
    if (sourcePath !== null) {
      try {
        sourcePathState = (await fs.stat(sourcePath)).isDirectory()
          ? "exists"
          : "missing";
      } catch (error) {
        if (
          isFsErrorWithCode(error, "ENOENT") ||
          isFsErrorWithCode(error, "ENOTDIR")
        )
          sourcePathState = "missing";
        else if (
          !isFsErrorWithCode(error, "EACCES") &&
          !isFsErrorWithCode(error, "EPERM")
        )
          throw error;
      }
    }
    entries.push({
      name,
      sourcePath,
      sourcePathState,
      running: await daemonRunning(directory),
    });
  }
  return { entries };
}

export async function removeDeveloperEntries(
  input: z.infer<typeof hostStorageContract.removeDeveloperEntries.input>,
  signal: AbortSignal,
  retainWorker: () => { dispose(): void },
) {
  assertDeveloperInput(input);
  if (path.basename(input.rootPath) !== ".bb-dev")
    throw new Error("Invalid developer storage path");
  let root: string;
  try {
    root = await fs.realpath(input.rootPath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT"))
      return { removed: [], running: [], stoppedProcessCount: 0 };
    throw error;
  }
  const inspected = (await inspectDeveloperEntries(input, signal)).entries;
  const missing = inspected.filter(
    (entry): entry is typeof entry & { sourcePath: string } =>
      entry.sourcePath !== null && entry.sourcePathState === "missing",
  );
  const running =
    input.condition === "notRunning"
      ? inspected.filter(
          (entry) => entry.running && entry.sourcePathState !== "missing",
        )
      : [];
  const eligible =
    input.condition === "checkoutMissing"
      ? missing
      : inspected.filter((entry) => !running.includes(entry));
  const stoppedProcessCount = (
    await experimental_killProcessesWithCwdUnder({
      directories: missing.map((entry) => entry.sourcePath),
    })
  ).length;
  signal.throwIfAborted();
  const trashes = (await fs.readdir(root))
    .filter((name) => name.startsWith(".bb-trash-"))
    .map((name) => path.join(root, name));
  const removed: string[] = [];
  try {
    for (const entry of eligible) {
      signal.throwIfAborted();
      const source = path.join(root, entry.name);
      try {
        const stats = await fs.lstat(source);
        if (stats.isSymbolicLink()) {
          await fs.unlink(source);
          removed.push(entry.name);
          continue;
        }
        if (!stats.isDirectory()) continue;
        const trash = path.join(
          root,
          `.bb-trash-${entry.name}-${randomUUID()}`,
        );
        await fs.rename(source, trash);
        trashes.push(trash);
        removed.push(entry.name);
      } catch (error) {
        if (!isFsErrorWithCode(error, "ENOENT")) throw error;
      }
    }
  } finally {
    if (trashes.length > 0) {
      const lease = retainWorker();
      void (async () => {
        for (const trash of trashes)
          await fs
            .rm(trash, { recursive: true, force: true })
            .catch((error) => {
              console.error("Development storage cleanup failed", error);
            });
      })().finally(() => lease.dispose());
    }
  }
  return {
    removed,
    running: running.map((entry) => entry.name),
    stoppedProcessCount,
  };
}
