import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { inspectWorkspaceProcesses } from "./workspace-processes.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

const children: ChildProcess[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.mocked(execFile).mockRestore();
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "bb-workspace-procs-"));
  directories.push(directory);
  return directory;
}

async function start(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  const child = spawn(command, args, { cwd, stdio: "ignore" });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  return child.pid!;
}

function fakeTools(outputs: Record<string, string[]>): void {
  vi.mocked(execFile).mockImplementation(((
    command: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    const output = outputs[command]?.shift();
    if (output === undefined)
      callback(Object.assign(new Error("missing"), { code: "ENOENT" }), "");
    else callback(null, output);
  }) as never);
}

it.skipIf(process.platform !== "darwin")(
  "finds same-user processes whose cwd or mapped executable is inside the canonical workspace",
  async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, "workspace");
    const sibling = path.join(root, "workspace-other");
    await mkdir(path.join(workspace, "sub"), { recursive: true });
    await mkdir(sibling);
    await copyFile(
      process.execPath,
      path.join(workspace, "node"),
      constants.COPYFILE_FICLONE,
    );
    const inside = await start("sleep", ["30"], path.join(workspace, "sub"));
    const outside = await start("sleep", ["30"], sibling);
    const mapped = await start(
      path.join(workspace, "node"),
      ["-e", "setTimeout(() => {}, 30_000)"],
      "/",
    );
    expect(root.startsWith("/private/")).toBe(false);
    const inspection = await inspectWorkspaceProcesses(workspace);
    expect(inspection.supported).toBe(true);
    expect(inspection.pids).toEqual([inside, mapped].sort((a, b) => a - b));
    expect(inspection.unreadablePids).not.toContain(outside);
  },
);

it.skipIf(process.platform !== "darwin")(
  "reports no processes for an unused workspace",
  async () => {
    const workspace = await temporaryDirectory();
    await start("sleep", ["30"], path.dirname(workspace));
    const inspection = await inspectWorkspaceProcesses(workspace);
    expect(inspection.supported).toBe(true);
    expect(inspection.pids).toEqual([]);
  },
);

it.skipIf(process.platform !== "darwin")(
  "matches lsof-escaped workspace names without matching sibling paths",
  async () => {
    const root = await temporaryDirectory();
    const workspace = path.join(root, "we ird\nna\\me-é");
    await mkdir(workspace);
    const inside = await start("sleep", ["30"], workspace);
    const outside = await start("sleep", ["30"], root);
    const inspection = await inspectWorkspaceProcesses(workspace);
    expect(inspection.pids).toContain(inside);
    expect(inspection.pids).not.toContain(outside);
  },
);

it.skipIf(process.platform !== "darwin")(
  "refuses rather than reporting a clean workspace when lsof is unavailable",
  async () => {
    fakeTools({ "/bin/ps": [`4242 ${process.getuid!()} 0 0 S\n`] });
    expect(await inspectWorkspaceProcesses("/workspace")).toEqual({
      supported: false,
      pids: [],
      unreadablePids: [],
    });
  },
);

it.skipIf(process.platform !== "darwin")(
  "reports live uninspectable same-user processes but not exited, zombie, or setuid processes of another effective user",
  async () => {
    const uid = process.getuid!();
    fakeTools({
      "/bin/ps": [
        [
          `501 ${uid} ${uid} ${uid} S`,
          `502 0 ${uid} 0 Ss`,
          `503 ${uid} ${uid} ${uid} S`,
          `504 ${uid} ${uid} ${uid} R`,
          `505 ${uid + 1} ${uid + 1} ${uid + 1} S`,
          `506 ${uid} ${uid} ${uid} Z`,
        ].join("\n"),
        [`501 ${uid} ${uid} ${uid} S`, `502 0 ${uid} 0 Ss`].join("\n"),
      ],
      "/usr/sbin/lsof": [
        ["p504", "fcwd", "n/elsewhere", "ftxt", "n/workspace/bin/tool"].join(
          "\n",
        ),
      ],
    });
    expect(await inspectWorkspaceProcesses("/workspace")).toEqual({
      supported: true,
      pids: [504],
      unreadablePids: [501],
    });
  },
);
