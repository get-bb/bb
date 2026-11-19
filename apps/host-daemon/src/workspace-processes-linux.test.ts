import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectWorkspaceProcesses } from "./workspace-processes.js";

const linux = process.platform === "linux";
const hasPython = linux && spawnSync("python3", ["-c", "pass"]).status === 0;
const canUnshare =
  linux &&
  spawnSync("unshare", ["-Urm", "true"], { stdio: "ignore" }).status === 0;

const children: ChildProcess[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "bb-workspace-processes-")),
  );
  directories.push(directory);
  return directory;
}

async function startProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  const ready = await new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`${command} exited early with ${code}`)),
    );
    child.stdout!.once("data", (chunk: Buffer) => resolve(chunk.toString()));
  });
  return Number(ready.trim());
}

const NON_DUMPABLE_SLEEP =
  "import ctypes, os, sys, time\n" +
  "ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)\n" +
  "print(os.getpid(), flush=True)\n" +
  "time.sleep(60)\n";

it.skipIf(!hasPython)(
  "does not refuse for a non-dumpable process in the daemon's own mount namespace",
  async () => {
    const workspace = await temporaryDirectory();
    const elsewhere = await temporaryDirectory();
    const pid = await startProcess(
      "python3",
      ["-c", NON_DUMPABLE_SLEEP],
      elsewhere,
    );

    const result = await inspectWorkspaceProcesses(workspace);

    expect(result.supported).toBe(true);
    expect(result.unreadablePids).not.toContain(pid);
    expect(result.pids).not.toContain(pid);
  },
);

it.skipIf(!canUnshare)(
  "finds a process in another mount namespace that works in the workspace through a bind mount",
  async () => {
    const workspace = await temporaryDirectory();
    await mkdir(path.join(workspace, "src"));
    const target = path.join(await temporaryDirectory(), "mounted");
    await mkdir(target);
    const pid = await startProcess(
      "unshare",
      [
        "-Urm",
        "sh",
        "-c",
        `mount --bind "$1" "$2" && cd "$2/src" && echo $$ && exec sleep 60`,
        "sh",
        workspace,
        target,
      ],
      tmpdir(),
    );

    const result = await inspectWorkspaceProcesses(workspace);

    expect(result.pids).toContain(pid);
    expect(result.unreadablePids).not.toContain(pid);
  },
);

it.skipIf(!canUnshare)(
  "ignores a process in another mount namespace that does not work in the workspace",
  async () => {
    const workspace = await temporaryDirectory();
    const elsewhere = await temporaryDirectory();
    const pid = await startProcess(
      "unshare",
      [
        "-Urm",
        "sh",
        "-c",
        `cd "$1" && echo $$ && exec sleep 60`,
        "sh",
        elsewhere,
      ],
      tmpdir(),
    );

    const result = await inspectWorkspaceProcesses(workspace);

    expect(result.pids).not.toContain(pid);
    expect(result.unreadablePids).not.toContain(pid);
  },
);
