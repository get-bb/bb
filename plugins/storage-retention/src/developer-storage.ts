import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
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
    entries.push({ name, sourcePath, sourcePathState });
  }
  return { entries };
}

const execFileAsync = promisify(execFile);
const windowsProcessSchema = z.object({
  ProcessId: z.number().int(),
  CommandLine: z.string().nullable(),
});

async function listProcesses() {
  if (process.platform === "win32") {
    const pending = execFileAsync(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    pending.child.stdin?.end();
    const parsed = z
      .union([windowsProcessSchema, z.array(windowsProcessSchema)])
      .parse(JSON.parse((await pending).stdout));
    return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) =>
      entry.CommandLine === null
        ? []
        : [{ pid: entry.ProcessId, command: entry.CommandLine }],
    );
  }
  const { stdout } = await execFileAsync(
    "ps",
    ["-A", "-ww", "-o", "pid=", "-o", "args="],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match ? [{ pid: Number(match[1]), command: match[2]! }] : [];
  });
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isFsErrorWithCode(error, "ESRCH");
  }
}

function normalizeCommand(value: string) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function runsFrom(command: string, sourcePath: string) {
  return normalizeCommand(command).includes(
    normalizeCommand(`${sourcePath.replace(/[\\/]+$/, "")}${path.sep}`),
  );
}

async function stopProcessesFrom(sourcePaths: string[], signal: AbortSignal) {
  const running = async () =>
    (await listProcesses()).filter(
      (entry) =>
        entry.pid !== process.pid &&
        sourcePaths.some((source) => runsFrom(entry.command, source)),
    );
  const stopped = new Set<number>();
  for (const kill of ["SIGTERM", "SIGKILL"] as const) {
    signal.throwIfAborted();
    const targets = await running();
    if (targets.length === 0) break;
    for (const target of targets) {
      try {
        process.kill(target.pid, kill);
        stopped.add(target.pid);
      } catch (error) {
        if (!isFsErrorWithCode(error, "ESRCH")) throw error;
      }
    }
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      targets.some((target) => isAlive(target.pid))
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { stopped: stopped.size, survivors: await running() };
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
      return { removed: [], stoppedProcessCount: 0 };
    throw error;
  }
  const missing = (await inspectDeveloperEntries(input, signal)).entries.filter(
    (entry): entry is typeof entry & { sourcePath: string } =>
      entry.sourcePath !== null && entry.sourcePathState === "missing",
  );
  const { stopped, survivors } = await stopProcessesFrom(
    missing.map((entry) => entry.sourcePath),
    signal,
  );
  const trashes = (await fs.readdir(root))
    .filter((name) => name.startsWith(".bb-trash-"))
    .map((name) => path.join(root, name));
  const removed: string[] = [];
  try {
    for (const entry of missing) {
      signal.throwIfAborted();
      if (
        survivors.some((survivor) =>
          runsFrom(survivor.command, entry.sourcePath),
        )
      )
        continue;
      const source = path.join(root, entry.name);
      try {
        const stats = await fs.lstat(source);
        if (stats.isSymbolicLink() || !stats.isDirectory())
          throw new Error(
            "Development instance must be a directory, not a symbolic link",
          );
        const trash = path.join(root, `.bb-trash-${entry.name}-${randomUUID()}`);
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
          await fs.rm(trash, { recursive: true, force: true }).catch((error) => {
            console.error("Development storage cleanup failed", error);
          });
      })().finally(() => lease.dispose());
    }
  }
  return { removed, stoppedProcessCount: stopped };
}
