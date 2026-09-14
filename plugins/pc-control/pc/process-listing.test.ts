import { describe, expect, it } from "vitest";
import {
  POSIX_LIST_ARGS,
  ProcessCpuTracker,
  collectProcessList,
  parseCsvLine,
  parsePosixPs,
  parseWindowsCsv,
  rankProcesses,
  windowsListArgs,
  type CommandRunner,
} from "./process-listing.js";

const CSV_FIXTURE = [
  '"Id","ProcessName","CPU","WorkingSet64","Path"',
  '"4","System","","8192",""',
  '"1200","chrome","123.45","104857600","C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
  '"1300","my, tool","10","2048","C:\\Tools\\my, tool\\tool.exe"',
  '"1400","locale","21,890625","4096",""',
  '"bad","notapid","1","1",""',
  '"1500","","1","1",""',
].join("\r\n");

describe("csv parsing", () => {
  it("parses quoted fields with escaped quotes and embedded commas", () => {
    expect(parseCsvLine('"a,b","c""d",e')).toEqual(["a,b", 'c"d', "e"]);
  });

  it("returns null for unterminated quotes", () => {
    expect(parseCsvLine('"open,end')).toBeNull();
  });

  it("parses the windows fixture", () => {
    const entries = parseWindowsCsv(CSV_FIXTURE);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      pid: 4,
      name: "System",
      cpuSeconds: null,
      memoryBytes: 8_192,
      exePath: null,
    });
    expect(entries[1]?.pid).toBe(1_200);
    expect(entries[1]?.cpuSeconds).toBeCloseTo(123.45, 5);
    expect(entries[1]?.memoryBytes).toBe(104_857_600);
    expect(entries[1]?.exePath).toBe(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    );
    expect(entries[2]?.name).toBe("my, tool");
    expect(entries[3]?.cpuSeconds).toBeCloseTo(21.890625, 5);
  });

  it("returns empty when the header is missing", () => {
    expect(parseWindowsCsv("no,header,here")).toEqual([]);
  });
});

describe("posix ps parsing", () => {
  it("parses pid, percent, rss, and command", () => {
    const stdout = [
      "   12  1.5  20480 /usr/libexec/something",
      "  345 99.9 524288 /Applications/App.app/Contents/MacOS/App",
      "not a process line",
      "",
    ].join("\n");
    const entries = parsePosixPs(stdout);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      pid: 12,
      name: "/usr/libexec/something",
      cpuSeconds: 1.5,
      memoryBytes: 20_971_520,
      exePath: null,
    });
    expect(entries[1]?.cpuSeconds).toBeCloseTo(99.9, 5);
  });
});

describe("ProcessCpuTracker", () => {
  it("returns null cpu when the clock does not advance", () => {
    const tracker = new ProcessCpuTracker(() => 0);
    tracker.toSamples(
      [
        { pid: 1, name: "a", cpuSeconds: 10, memoryBytes: 1, exePath: null },
        { pid: 2, name: "b", cpuSeconds: 0, memoryBytes: 2, exePath: null },
      ],
      false,
    );
    const samples = tracker.toSamples(
      [
        { pid: 1, name: "a", cpuSeconds: 15, memoryBytes: 1, exePath: null },
        { pid: 2, name: "b", cpuSeconds: 0.25, memoryBytes: 2, exePath: null },
      ],
      false,
    ).map((sample) => ({ pid: sample.pid, cpu: sample.cpuPercent }));
    expect(samples).toEqual([
      { pid: 1, cpu: null },
      { pid: 2, cpu: null },
    ]);
  });

  it("uses wall-clock deltas from the injected clock", () => {
    let now = 0;
    const tracker = new ProcessCpuTracker(() => now);
    tracker.toSamples(
      [{ pid: 1, name: "a", cpuSeconds: 10, memoryBytes: 1, exePath: null }],
      false,
    );
    now = 2_000;
    const samples = tracker.toSamples(
      [{ pid: 1, name: "a", cpuSeconds: 12, memoryBytes: 1, exePath: null }],
      false,
    );
    expect(samples[0]?.cpuPercent).toBeCloseTo(100, 5);
  });

  it("passes posix percent straight through", () => {
    const tracker = new ProcessCpuTracker(() => 0);
    const samples = tracker.toSamples(
      [{ pid: 9, name: "app", cpuSeconds: 42.5, memoryBytes: 5, exePath: null }],
      true,
    );
    expect(samples[0]?.cpuPercent).toBe(42.5);
  });
});

describe("rankProcesses", () => {
  it("sorts by cpu with nulls last and memory tiebreak", () => {
    const ranked = rankProcesses([
      { pid: 1, name: "null", cpuPercent: null, memoryBytes: 10 },
      { pid: 2, name: "low", cpuPercent: 5, memoryBytes: 10 },
      { pid: 3, name: "high", cpuPercent: 90, memoryBytes: 10 },
      { pid: 4, name: "tie", cpuPercent: 5, memoryBytes: 99 },
    ]);
    expect(ranked.processes.map((sample) => sample.pid)).toEqual([
      3, 4, 2, 1,
    ]);
    expect(ranked.truncated).toBe(false);
  });
});

describe("collectProcessList", () => {
  it("runs powershell with a constant argv on windows and parses csv", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const run: CommandRunner = async (file, args) => {
      calls.push({ file, args });
      return { stdout: CSV_FIXTURE, stderr: "", exitCode: 0 };
    };
    let now = 0;
    const tracker = new ProcessCpuTracker(() => now);
    const first = await collectProcessList(
      { run, platform: "win32", now: () => now, tracker },
      "powershell.exe",
    );
    expect(calls[0]?.file).toBe("powershell.exe");
    expect(calls[0]?.args).toEqual(windowsListArgs());
    expect(windowsListArgs()).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      expect.stringContaining("Get-Process"),
    ]);
    expect(first.processes).toHaveLength(4);
    expect(first.truncated).toBe(false);
    now = 1_000;
    const second = await collectProcessList(
      { run, platform: "win32", now: () => now, tracker },
      "powershell.exe",
    );
    const chrome = second.processes.find((sample) => sample.pid === 1_200);
    expect(chrome?.cpuPercent).not.toBeNull();
  });

  it("runs ps with constant argv on posix", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const run: CommandRunner = async (file, args) => {
      calls.push({ file, args });
      return {
        stdout: "  12  1.5  20480 /usr/libexec/something",
        stderr: "",
        exitCode: 0,
      };
    };
    const result = await collectProcessList(
      {
        run,
        platform: "linux",
        now: () => 0,
        tracker: new ProcessCpuTracker(() => 0),
      },
      "ps",
    );
    expect(calls[0]?.file).toBe("ps");
    expect(calls[0]?.args).toEqual([...POSIX_LIST_ARGS]);
    expect(result.processes[0]?.name).toBe("/usr/libexec/something");
    expect(result.processes[0]?.cpuPercent).toBe(1.5);
  });

  it("surfaces non-zero exits as errors", async () => {
    const run: CommandRunner = async () => ({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
    });
    await expect(
      collectProcessList(
        {
          run,
          platform: "win32",
          now: () => 0,
          tracker: new ProcessCpuTracker(() => 0),
        },
        "powershell.exe",
      ),
    ).rejects.toThrow(/boom/u);
  });
});
