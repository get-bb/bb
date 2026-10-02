import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
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

export async function inspectDeveloperEntries(
  input: z.infer<typeof hostStorageContract.inspectDeveloperEntries.input>,
  signal: AbortSignal,
) {
  if (
    !path.isAbsolute(input.rootPath) ||
    input.names.some(
      (name) => name === "." || name === ".." || /[\\/\0]/.test(name),
    ) ||
    input.candidatePaths.some((candidate) => !path.isAbsolute(candidate))
  )
    throw new Error("Invalid developer storage path");
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
    entries.push({ name, sourcePath, sourcePathState });
  }
  return { entries };
}
