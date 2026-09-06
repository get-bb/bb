import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildWindowsTaskkillRequest,
  clearSweepRootProcesses,
  isWindowsPathUnderDirectory,
  killProcessGroup,
  killProcessesWithCwdUnder,
  listProcessesWithCwdUnder,
  matchWindowsProcessesUnderDirectory,
  parseWindowsProcessSnapshot,
  registerSweepRootProcess,
  spawnPortableProcess,
  stopProcessGroupLeaderFirst,
  unregisterSweepRootProcess,
  WINDOWS_PROCESS_ENUM_TIMEOUT_MS,
  type WindowsCommandRequest,
  type WindowsCommandResult,
  type WindowsProcessSnapshotEntry,
} from "../src/index.js";

const CIM_SAMPLE = `[
  {"ProcessId": 4, "ParentProcessId": 0, "ExecutablePath": null, "CommandLine": null},
  {"ProcessId": 624, "ParentProcessId": 4, "ExecutablePath": "C:\\\\Windows\\\\System32\\\\services.exe", "CommandLine": "C:\\\\Windows\\\\system32\\\\services.exe"},
  {"ProcessId": 880, "ParentProcessId": 624, "ExecutablePath": "C:\\\\Windows\\\\System32\\\\svchost.exe", "CommandLine": "C:\\\\Windows\\\\system32\\\\svchost.exe -k netsvcs"},
  {"ProcessId": 1234, "ParentProcessId": 880, "ExecutablePath": "C:\\\\Program Files\\\\nodejs\\\\node.exe", "CommandLine": "\\"C:\\\\Program Files\\\\nodejs\\\\node.exe\\" \\"C:\\\\work\\\\bb\\\\scripts\\\\start-bb.mjs\\""},
  {"ProcessId": 4242, "ParentProcessId": 1234, "ExecutablePath": "C:\\\\work\\\\bb\\\\tools\\\\agent.exe", "CommandLine": "\\"C:\\\\work\\\\bb\\\\tools\\\\agent.exe\\" --workspace C:\\\\work\\\\bb"},
  {"ProcessId": 4243, "ParentProcessId": 4242, "ExecutablePath": "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe", "CommandLine": "powershell.exe -NoLogo -Command \\"while ($true) { Start-Sleep 10 }\\""},
  {"ProcessId": 4244, "ParentProcessId": 4243, "ExecutablePath": null, "CommandLine": null}
]`;

const SWEEP_DIRECTORY = "C:\\work\\bb";

const WINDOWS_ENUM_REQUEST: WindowsCommandRequest = {
  command: "powershell.exe",
  args: [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
  ],
};

function okResult(stdout: string): WindowsCommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function recordingRunner(
  requests: WindowsCommandRequest[],
  handle: (request: WindowsCommandRequest) => Promise<WindowsCommandResult>,
): (request: WindowsCommandRequest) => Promise<WindowsCommandResult> {
  return async (request) => {
    requests.push(request);
    return handle(request);
  };
}

function createFakeChild(
  pid: number,
  exited: boolean,
): { child: ChildProcess; signals: NodeJS.Signals[] } {
  const signals: NodeJS.Signals[] = [];
  const child = {
    pid,
    exitCode: exited ? 0 : null,
    signalCode: null,
    kill: (signal: NodeJS.Signals) => {
      signals.push(signal);
      return true;
    },
  };
  return { child: child as unknown as ChildProcess, signals };
}

describe("windows path comparison", () => {
  it.each([
    ["C:\\work\\bb\\tools\\agent.exe", "C:\\work\\bb", true],
    ["C:/work/bb/tools/agent.exe", "C:\\work\\bb", true],
    ["c:\\WORK\\bb", "C:\\work\\bb", true],
    ["C:\\work\\bb", "C:\\work\\bb\\", true],
    ["C:\\work\\bb-other\\x.exe", "C:\\work\\bb", false],
    ["\\\\?\\C:\\work\\bb\\agent.exe", "C:\\work\\bb", true],
    ["\\\\server\\share\\job.exe", "\\\\server\\share", true],
    ["\\\\?\\UNC\\server\\share\\job.exe", "\\\\server\\share", true],
    ["C:\\proyectos\\diseño\\app.exe", "C:\\proyectos\\diseño", true],
    ["C:\\work\\bb", "C:\\", true],
    ["D:\\other\\x.exe", "C:\\work", false],
  ])("compares %s against %s as %s", (candidate, directory, expected) => {
    expect(isWindowsPathUnderDirectory(candidate, directory)).toBe(expected);
  });
});

describe("parseWindowsProcessSnapshot", () => {
  it("parses a realistic Get-CimInstance Win32_Process payload", () => {
    const snapshot = parseWindowsProcessSnapshot(CIM_SAMPLE);
    expect(snapshot).toHaveLength(7);
    expect(snapshot[0]).toEqual({
      processId: 4,
      parentProcessId: 0,
      executablePath: null,
      commandLine: null,
    });
    expect(snapshot[4]).toEqual({
      processId: 4242,
      parentProcessId: 1234,
      executablePath: "C:\\work\\bb\\tools\\agent.exe",
      commandLine:
        '"C:\\work\\bb\\tools\\agent.exe" --workspace C:\\work\\bb',
    });
  });

  it("wraps a single object payload", () => {
    expect(
      parseWindowsProcessSnapshot(
        '{"ProcessId": 42, "ParentProcessId": 7, "ExecutablePath": null, "CommandLine": null}',
      ),
    ).toEqual([
      {
        processId: 42,
        parentProcessId: 7,
        executablePath: null,
        commandLine: null,
      },
    ]);
  });

  it("tolerates a leading byte-order mark", () => {
    expect(
      parseWindowsProcessSnapshot(`\uFEFF${CIM_SAMPLE}`),
    ).toHaveLength(7);
  });

  it("returns an empty list for empty or null payloads", () => {
    expect(parseWindowsProcessSnapshot("")).toEqual([]);
    expect(parseWindowsProcessSnapshot("   ")).toEqual([]);
    expect(parseWindowsProcessSnapshot("null")).toEqual([]);
  });

  it("throws on output that is not JSON", () => {
    expect(() => parseWindowsProcessSnapshot("Get-CimInstance: boom")).toThrow(
      /Unable to parse Get-CimInstance/,
    );
  });

  it("skips entries without a usable process id", () => {
    const snapshot = parseWindowsProcessSnapshot(
      '[{"Nope": 1}, {"ProcessId": 0}, {"ProcessId": -5}, {"ProcessId": "abc"}, {"ProcessId": 42, "ParentProcessId": 7}]',
    );
    expect(snapshot).toEqual([
      {
        processId: 42,
        parentProcessId: 7,
        executablePath: null,
        commandLine: null,
      },
    ]);
  });
});

describe("matchWindowsProcessesUnderDirectory", () => {
  const snapshot: WindowsProcessSnapshotEntry[] =
    parseWindowsProcessSnapshot(CIM_SAMPLE);

  it("matches by executable path and flags the cwd as approximate", () => {
    const found = matchWindowsProcessesUnderDirectory({
      snapshot,
      directory: SWEEP_DIRECTORY,
    });
    expect(found).toContainEqual({
      pid: 4242,
      cwd: "C:\\work\\bb\\tools\\agent.exe",
      approximateCwd: true,
    });
  });

  it("matches by a command-line path when the executable lives elsewhere", () => {
    const found = matchWindowsProcessesUnderDirectory({
      snapshot,
      directory: SWEEP_DIRECTORY,
    });
    expect(found).toContainEqual({
      pid: 1234,
      cwd: "C:\\work\\bb\\scripts\\start-bb.mjs",
      approximateCwd: true,
    });
  });

  it("expands the match through the parent-process tree", () => {
    const found = matchWindowsProcessesUnderDirectory({
      snapshot,
      directory: SWEEP_DIRECTORY,
    });
    expect(found.map((entry) => entry.pid).sort((a, b) => a - b)).toEqual([
      1234, 4242, 4243, 4244,
    ]);
    expect(found).toContainEqual({
      pid: 4244,
      cwd: "C:\\work\\bb\\tools\\agent.exe",
      approximateCwd: true,
    });
  });

  it("leaves unrelated processes alone", () => {
    const found = matchWindowsProcessesUnderDirectory({
      snapshot,
      directory: "C:\\unrelated",
    });
    expect(found).toEqual([]);
  });

  it("excludes the sweeping process and everything below it", () => {
    const found = matchWindowsProcessesUnderDirectory({
      snapshot,
      directory: SWEEP_DIRECTORY,
      selfPid: 4242,
    });
    expect(found.map((entry) => entry.pid)).toEqual([1234]);
  });

  it("matches processes the current runtime launched itself", () => {
    const tracked = new Map([[9001, SWEEP_DIRECTORY]]);
    const ownSnapshot: WindowsProcessSnapshotEntry[] = [
      {
        processId: 9001,
        parentProcessId: 1,
        executablePath: "C:\\Windows\\System32\\conhost.exe",
        commandLine: "conhost.exe --headless",
      },
    ];
    expect(
      matchWindowsProcessesUnderDirectory({
        snapshot: ownSnapshot,
        directory: SWEEP_DIRECTORY,
        trackedRoots: tracked,
      }),
    ).toEqual([{ pid: 9001, cwd: SWEEP_DIRECTORY, approximateCwd: true }]);
    expect(
      matchWindowsProcessesUnderDirectory({
        snapshot: ownSnapshot,
        directory: "C:\\elsewhere",
        trackedRoots: tracked,
      }),
    ).toEqual([]);
  });

  it("reaches orphans whose tracked parent already exited", () => {
    const tracked = new Map([[9000, SWEEP_DIRECTORY]]);
    const orphans: WindowsProcessSnapshotEntry[] = [
      {
        processId: 9001,
        parentProcessId: 9000,
        executablePath: null,
        commandLine: null,
      },
    ];
    expect(
      matchWindowsProcessesUnderDirectory({
        snapshot: orphans,
        directory: SWEEP_DIRECTORY,
        trackedRoots: tracked,
      }),
    ).toEqual([{ pid: 9001, cwd: SWEEP_DIRECTORY, approximateCwd: true }]);
  });
});

describe("listProcessesWithCwdUnder on win32", () => {
  beforeEach(() => {
    clearSweepRootProcesses();
  });

  afterEach(() => {
    clearSweepRootProcesses();
  });

  it("enumerates through powershell CIM with the exact pinned command", async () => {
    const requests: WindowsCommandRequest[] = [];
    const found = await listProcessesWithCwdUnder({
      directory: SWEEP_DIRECTORY,
      platform: "win32",
      runWindowsCommand: recordingRunner(requests, async () =>
        okResult(CIM_SAMPLE),
      ),
    });
    expect(requests).toEqual([WINDOWS_ENUM_REQUEST]);
    expect(
      found
        .map((entry) => entry.pid)
        .filter((pid) => pid !== process.pid)
        .sort((a, b) => a - b),
    ).toEqual([1234, 4242, 4243, 4244]);
    for (const entry of found) {
      expect(entry.approximateCwd).toBe(true);
    }
  });

  it("rejects when the enumeration command exits nonzero", async () => {
    await expect(
      listProcessesWithCwdUnder({
        directory: SWEEP_DIRECTORY,
        platform: "win32",
        runWindowsCommand: async () => ({
          stdout: "",
          stderr: "Get-CimInstance: Access is denied.",
          exitCode: 1,
        }),
      }),
    ).rejects.toThrow(/powershell\.exe.*Access is denied/);
  });

  it("rejects when the enumeration command cannot even start", async () => {
    await expect(
      listProcessesWithCwdUnder({
        directory: SWEEP_DIRECTORY,
        platform: "win32",
        runWindowsCommand: async () => {
          throw new Error("spawn powershell.exe ENOENT");
        },
      }),
    ).rejects.toThrow(/spawn powershell\.exe ENOENT/);
  });

  it("pins the default CIM probe timeout", () => {
    expect(WINDOWS_PROCESS_ENUM_TIMEOUT_MS).toBe(10_000);
  });

  it("rejects instead of hanging when the CIM probe never settles", async () => {
    await expect(
      listProcessesWithCwdUnder({
        directory: SWEEP_DIRECTORY,
        platform: "win32",
        processEnumTimeoutMs: 50,
        runWindowsCommand: () => new Promise<WindowsCommandResult>(() => {}),
      }),
    ).rejects.toThrow(/powershell\.exe.*timed out after 50ms/);
  });

  it("still enumerates when the CIM probe answers within the timeout", async () => {
    const found = await listProcessesWithCwdUnder({
      directory: SWEEP_DIRECTORY,
      platform: "win32",
      processEnumTimeoutMs: 5_000,
      runWindowsCommand: async () => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        return okResult(CIM_SAMPLE);
      },
    });
    expect(
      found
        .map((entry) => entry.pid)
        .filter((pid) => pid !== process.pid)
        .sort((a, b) => a - b),
    ).toEqual([1234, 4242, 4243, 4244]);
  });
});

describe("killProcessesWithCwdUnder on win32", () => {
  beforeEach(() => {
    clearSweepRootProcesses();
  });

  afterEach(() => {
    clearSweepRootProcesses();
  });

  it("kills the whole tree with taskkill /T /F", async () => {
    const requests: WindowsCommandRequest[] = [];
    let enumServed = false;
    const killed = await killProcessesWithCwdUnder({
      directory: SWEEP_DIRECTORY,
      platform: "win32",
      runWindowsCommand: recordingRunner(requests, async (request) => {
        if (request.command === "powershell.exe") {
          if (!enumServed) {
            enumServed = true;
            return okResult(CIM_SAMPLE);
          }
          return okResult("[]");
        }
        return okResult("");
      }),
      isProcessAlive: () => false,
    });
    const taskkillRequests = requests.filter(
      (request) => request.command === "taskkill.exe",
    );
    const killedPids = killed
      .map((entry) => entry.pid)
      .filter((pid) => pid !== process.pid)
      .sort((a, b) => a - b);
    expect(killedPids).toEqual([1234, 4242, 4243, 4244]);
    expect(
      taskkillRequests.map((request) => request.args[1]).sort(),
    ).toEqual(killedPids.map(String));
    for (const request of taskkillRequests) {
      expect(request.command).toBe("taskkill.exe");
      expect(request.args.slice(0, 1)).toEqual(["/PID"]);
      expect(request.args.slice(2)).toEqual(["/T", "/F"]);
    }
    expect(requests[0]).toEqual(WINDOWS_ENUM_REQUEST);
  });

  it("builds the exact taskkill request for a pid", () => {
    expect(buildWindowsTaskkillRequest(4242)).toEqual({
      command: "taskkill.exe",
      args: ["/PID", "4242", "/T", "/F"],
    });
  });

  it("surfaces taskkill failures instead of swallowing them", async () => {
    await expect(
      killProcessesWithCwdUnder({
        directory: SWEEP_DIRECTORY,
        platform: "win32",
        graceMs: 0,
        runWindowsCommand: async (request) => {
          if (request.command === "powershell.exe") {
            return okResult(CIM_SAMPLE);
          }
          return {
            stdout: "",
            stderr: "ERROR: Access is denied.",
            exitCode: 1,
          };
        },
        isProcessAlive: () => true,
      }),
    ).rejects.toThrow(/pid 4242.*Access is denied/);
  });

  it("tolerates a not-found failure for a process that already exited", async () => {
    const single = parseWindowsProcessSnapshot(CIM_SAMPLE).filter(
      (entry) => entry.processId === 4242,
    );
    const killed = await killProcessesWithCwdUnder({
      directory: SWEEP_DIRECTORY,
      platform: "win32",
      runWindowsCommand: async (request) => {
        if (request.command === "powershell.exe") {
          return okResult(JSON.stringify(single));
        }
        return {
          stdout: "",
          stderr: 'ERROR: The process "4242" not found.',
          exitCode: 128,
        };
      },
      isProcessAlive: () => false,
    });
    expect(killed).toEqual([
      {
        pid: 4242,
        cwd: "C:\\work\\bb\\tools\\agent.exe",
        approximateCwd: true,
      },
    ]);
  });

  it("propagates enumeration failures instead of reporting an empty sweep", async () => {
    await expect(
      killProcessesWithCwdUnder({
        directory: SWEEP_DIRECTORY,
        platform: "win32",
        runWindowsCommand: async (request) => {
          if (request.command === "powershell.exe") {
            throw new Error("CIM probe exploded");
          }
          return okResult("");
        },
        isProcessAlive: () => false,
      }),
    ).rejects.toThrow(/CIM probe exploded/);
  });

  it("rejects on a hung CIM probe instead of hanging the sweep", async () => {
    await expect(
      killProcessesWithCwdUnder({
        directory: SWEEP_DIRECTORY,
        platform: "win32",
        processEnumTimeoutMs: 50,
        runWindowsCommand: () => new Promise<WindowsCommandResult>(() => {}),
        isProcessAlive: () => false,
      }),
    ).rejects.toThrow(/timed out after 50ms/);
  });
});

describe("killProcessGroup", () => {
  it("kills the tree with taskkill on win32", () => {
    const taskkilled: number[] = [];
    const kills: NodeJS.Signals[] = [];
    killProcessGroup({
      child: {
        pid: 4242,
        kill: (signal) => {
          kills.push(signal);
          return true;
        },
      },
      signal: "SIGKILL",
      platform: "win32",
      runWindowsTaskkillSync: (pid) => {
        taskkilled.push(pid);
        return true;
      },
    });
    expect(taskkilled).toEqual([4242]);
    expect(kills).toEqual([]);
  });

  it("falls back to the child kill when taskkill fails on win32", () => {
    const kills: NodeJS.Signals[] = [];
    killProcessGroup({
      child: {
        pid: 4242,
        kill: (signal) => {
          kills.push(signal);
          return true;
        },
      },
      signal: "SIGTERM",
      platform: "win32",
      runWindowsTaskkillSync: () => false,
    });
    expect(kills).toEqual(["SIGTERM"]);
  });

  it("falls back to the child kill without a pid on win32", () => {
    const kills: NodeJS.Signals[] = [];
    killProcessGroup({
      child: {
        pid: undefined,
        kill: (signal) => {
          kills.push(signal);
          return true;
        },
      },
      signal: "SIGTERM",
      platform: "win32",
      runWindowsTaskkillSync: () => {
        throw new Error("must not run without a pid");
      },
    });
    expect(kills).toEqual(["SIGTERM"]);
  });

  it("falls back to the child kill when the posix group kill misses", () => {
    const kills: NodeJS.Signals[] = [];
    killProcessGroup({
      child: {
        pid: 2 ** 30,
        kill: (signal) => {
          kills.push(signal);
          return true;
        },
      },
      signal: "SIGKILL",
      platform: "linux",
    });
    expect(kills).toEqual(["SIGKILL"]);
  });
});

describe("stopProcessGroupLeaderFirst on win32", () => {
  it("reaps the tree with taskkill instead of group signals", async () => {
    const requests: WindowsCommandRequest[] = [];
    const { child, signals } = createFakeChild(4242, false);
    await stopProcessGroupLeaderFirst({
      child,
      timeoutMs: 20,
      killGraceMs: 0,
      platform: "win32",
      runWindowsCommand: recordingRunner(requests, async () =>
        okResult(""),
      ),
      isProcessAlive: () => false,
    });
    expect(requests).toEqual([buildWindowsTaskkillRequest(4242)]);
    expect(signals[0]).toBe("SIGTERM");
  });

  it("still taskkills the tree when the leader already exited", async () => {
    const requests: WindowsCommandRequest[] = [];
    const { child, signals } = createFakeChild(4242, true);
    await stopProcessGroupLeaderFirst({
      child,
      timeoutMs: 20,
      killGraceMs: 0,
      platform: "win32",
      runWindowsCommand: recordingRunner(requests, async () =>
        okResult(""),
      ),
      isProcessAlive: () => false,
    });
    expect(requests).toEqual([buildWindowsTaskkillRequest(4242)]);
    expect(signals).toEqual([]);
  });
});

describe("sweep root registry", () => {
  const live: WindowsProcessSnapshotEntry[] = [
    {
      processId: 9501,
      parentProcessId: 1,
      executablePath: "C:\\Windows\\System32\\conhost.exe",
      commandLine: "conhost.exe --headless",
    },
  ];

  beforeEach(() => {
    clearSweepRootProcesses();
  });

  afterEach(() => {
    clearSweepRootProcesses();
  });

  async function listTracked(directory: string) {
    return listProcessesWithCwdUnder({
      directory,
      platform: "win32",
      runWindowsCommand: async () => okResult(JSON.stringify(live)),
    });
  }

  it("finds registered processes and forgets them on unregister", async () => {
    registerSweepRootProcess({ pid: 9501, cwd: "C:\\work\\bb" });
    expect(await listTracked(SWEEP_DIRECTORY)).toEqual([
      { pid: 9501, cwd: "C:\\work\\bb", approximateCwd: true },
    ]);
    unregisterSweepRootProcess(9501);
    expect(await listTracked(SWEEP_DIRECTORY)).toEqual([]);
  });

  it("ignores registrations that cannot identify a process", async () => {
    registerSweepRootProcess({ pid: 0, cwd: SWEEP_DIRECTORY });
    registerSweepRootProcess({ pid: -4, cwd: SWEEP_DIRECTORY });
    registerSweepRootProcess({ pid: 9501, cwd: "" });
    expect(await listTracked(SWEEP_DIRECTORY)).toEqual([]);
  });
});

describe("spawnPortableProcess sweep tracking", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    clearSweepRootProcesses();
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it("registers the spawn cwd so a later Windows sweep finds the child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-win-track-"));
    cleanupDirs.push(dir);
    const child = spawnPortableProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 10000);"],
      cwd: dir,
    });
    try {
      const pid = child.pid ?? 0;
      expect(pid).toBeGreaterThan(0);
      const snapshot = JSON.stringify([
        {
          ProcessId: pid,
          ParentProcessId: process.pid,
          ExecutablePath: "C:\\Windows\\System32\\conhost.exe",
          CommandLine: "conhost.exe --headless",
        },
      ]);
      const found = await listProcessesWithCwdUnder({
        directory: dir,
        platform: "win32",
        runWindowsCommand: async () => okResult(snapshot),
      });
      expect(found).toEqual([{ pid, cwd: dir, approximateCwd: true }]);
    } finally {
      child.kill("SIGKILL");
    }
    await once(child, "exit");
    expect(
      await listProcessesWithCwdUnder({
        directory: dir,
        platform: "win32",
        runWindowsCommand: async () => okResult("[]"),
      }),
    ).toEqual([]);
  });
});
