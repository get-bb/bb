import { describe, expect, it, vi } from "vitest";
import {
  entryMatchesIdentity,
  expectedProcessIdentity,
  startManagedApp,
  stopManagedProcesses,
  type AppsDeps,
  type ChildProcessLike,
  type SpawnLike,
} from "./apps.js";
import type { CommandRunner, RawProcessEntry } from "./process-listing.js";

interface AppsHarness {
  deps: AppsDeps;
  spawns: Array<{ file: string; args: readonly string[]; options: unknown }>;
  commands: Array<{ file: string; args: readonly string[] }>;
  entries: RawProcessEntry[];
  clock: { now: number };
}

function createHarness(options?: {
  entries?: RawProcessEntry[];
  platform?: NodeJS.Platform;
  files?: Record<string, { isFile: boolean; isDirectory: boolean }>;
  pids?: number[];
}): AppsHarness {
  const spawns: AppsHarness["spawns"] = [];
  const commands: Array<{ file: string; args: readonly string[] }> = [];
  const entries = options?.entries ?? [];
  const files = options?.files ?? {
    "C:\\Apps\\Tool\\tool.exe": { isFile: true, isDirectory: false },
    "C:\\Apps\\Tool": { isFile: false, isDirectory: true },
  };
  const pids = options?.pids ?? [777];
  const livePid = pids[0] ?? 777;
  const clock = { now: 0 };
  const spawn: SpawnLike = (file, args, spawnOptions) => {
    spawns.push({ file, args, options: spawnOptions });
    const child: ChildProcessLike = {
      pid: pids[spawns.length - 1],
      unref: vi.fn(),
    };
    return child;
  };
  const deps: AppsDeps = {
    run: async (file, args) => {
      commands.push({ file, args });
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    spawn,
    stat: async (target) => files[target] ?? null,
    platform: options?.platform ?? "win32",
    listRaw: async () => entries,
    delay: async () => {
      clock.now += 600;
      const index = entries.findIndex((entry) => entry.pid === livePid);
      if (index !== -1) entries.splice(index, 1);
    },
    now: () => clock.now,
  };
  return { deps, spawns, commands, entries, clock };
}

describe("entryMatchesIdentity", () => {
  it("matches by process name case-insensitively without extension", () => {
    expect(
      entryMatchesIdentity(
        { name: "Tool.EXE", exePath: null },
        "tool",
        "C:\\Apps\\Tool\\tool.exe",
      ),
    ).toBe(true);
  });

  it("matches by exe path when the name differs", () => {
    expect(
      entryMatchesIdentity(
        {
          name: "renamed",
          exePath: "C:/Apps/Tool/tool.exe",
        },
        "tool",
        "C:\\Apps\\Tool\\tool.exe",
      ),
    ).toBe(true);
  });

  it("rejects unrelated processes", () => {
    expect(
      entryMatchesIdentity(
        { name: "other", exePath: "C:\\Elsewhere\\other.exe" },
        "tool",
        "C:\\Apps\\Tool\\tool.exe",
      ),
    ).toBe(false);
  });

  it("derives the identity from the exe base name", () => {
    expect(expectedProcessIdentity("C:\\Apps\\Tool.exe")).toBe("tool");
  });
});

describe("startManagedApp", () => {
  it("spawns with argv only, detached, and returns the pid", async () => {
    const harness = createHarness();
    const result = await startManagedApp(harness.deps, {
      exePath: "C:\\Apps\\Tool\\tool.exe",
      args: ["--port", "8080"],
      cwd: "C:\\Apps\\Tool",
    });
    expect(result.pid).toBe(777);
    expect(harness.spawns).toHaveLength(1);
    expect(harness.spawns[0]?.file).toBe("C:\\Apps\\Tool\\tool.exe");
    expect(harness.spawns[0]?.args).toEqual(["--port", "8080"]);
    expect(harness.spawns[0]?.options).toEqual({
      cwd: "C:\\Apps\\Tool",
      stdio: "ignore",
      detached: true,
      windowsHide: false,
    });
  });

  it("rejects relative exe paths", async () => {
    const harness = createHarness();
    await expect(
      startManagedApp(harness.deps, {
        exePath: "tool.exe",
        args: [],
        cwd: "C:\\",
      }),
    ).rejects.toThrow(/absolute/u);
    expect(harness.spawns).toHaveLength(0);
  });

  it("rejects non-.exe executables on windows", async () => {
    const harness = createHarness();
    await expect(
      startManagedApp(harness.deps, {
        exePath: "C:\\Apps\\Tool\\tool.bat",
        args: [],
        cwd: "C:\\Apps\\Tool",
      }),
    ).rejects.toThrow(/\.exe/u);
  });

  it("rejects missing executables and working directories", async () => {
    const harness = createHarness();
    await expect(
      startManagedApp(harness.deps, {
        exePath: "C:\\Missing\\tool.exe",
        args: [],
        cwd: "C:\\Apps\\Tool",
      }),
    ).rejects.toThrow(/Executable was not found/u);
    await expect(
      startManagedApp(harness.deps, {
        exePath: "C:\\Apps\\Tool\\tool.exe",
        args: [],
        cwd: "C:\\Missing",
      }),
    ).rejects.toThrow(/Working directory was not found/u);
  });
});

describe("stopManagedProcesses", () => {
  function entriesFor(pids: number[]): RawProcessEntry[] {
    return pids.map((pid) => ({
      pid,
      name: "Tool",
      cpuSeconds: 1,
      memoryBytes: 1,
      exePath: "C:\\Apps\\Tool\\tool.exe",
    }));
  }

  it("kills only pids that still match the profile identity", async () => {
    const entries: RawProcessEntry[] = [
      ...entriesFor([777]),
      {
        pid: 888,
        name: "Unrelated",
        cpuSeconds: 1,
        memoryBytes: 1,
        exePath: "C:\\Elsewhere\\unrelated.exe",
      },
    ];
    const harness = createHarness({ entries, pids: [777] });
    const result = await stopManagedProcesses(harness.deps, {
      pids: [777, 888],
      processName: "Tool",
      exePath: "C:\\Apps\\Tool\\tool.exe",
    });
    expect(result.stoppedCount).toBe(1);
    expect(harness.commands).toEqual([
      { file: "taskkill", args: ["/PID", "777", "/T"] },
    ]);
  });

  it("escalates to forceful taskkill when graceful exit is ignored", async () => {
    const entries = entriesFor([777]);
    const commands: Array<{ file: string; args: readonly string[] }> = [];
    let forced = false;
    let clock = 0;
    const deps: AppsDeps = {
      run: async (file, args) => {
        commands.push({ file, args });
        if (args.includes("/F")) forced = true;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      spawn: (() => {
        throw new Error("spawn must not be used");
      }) as unknown as SpawnLike,
      stat: async () => null,
      platform: "win32",
      listRaw: async () => (forced ? [] : entries),
      delay: async () => {
        clock += 600;
      },
      now: () => clock,
    };
    const result = await stopManagedProcesses(deps, {
      pids: [777],
      processName: "Tool",
      exePath: "C:\\Apps\\Tool\\tool.exe",
    });
    expect(result.stoppedCount).toBe(1);
    expect(commands).toEqual([
      { file: "taskkill", args: ["/PID", "777", "/T"] },
      { file: "taskkill", args: ["/PID", "777", "/T", "/F"] },
    ]);
  });

  it("reports zero when nothing matching is running", async () => {
    const harness = createHarness({ entries: entriesFor([999]) });
    const result = await stopManagedProcesses(harness.deps, {
      pids: [999],
      processName: "Other",
      exePath: "C:\\Apps\\Other\\other.exe",
    });
    expect(result.stoppedCount).toBe(0);
    expect(harness.commands).toHaveLength(0);
  });
});
