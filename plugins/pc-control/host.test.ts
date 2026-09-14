import { describe, expect, it, vi } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createPcControlHostEntry } from "./host.js";
import type { CommandRunner } from "./pc/process-listing.js";
import type { MetricsDeps } from "./pc/metrics.js";
import type { AppsDeps } from "./pc/apps.js";
import { systemSnapshotSchema } from "./pc/schemas.js";

const CSV = [
  '"Id","ProcessName","CPU","WorkingSet64","Path"',
  '"100","Tool","5.0","1048576","C:\\Apps\\Tool\\tool.exe"',
  '"200","Tool","7.5","2097152","C:\\Apps\\Tool\\tool.exe"',
  '"300","Other","1.0","512","C:\\Elsewhere\\other.exe"',
].join("\r\n");

function fakeMetrics(): MetricsDeps {
  return {
    os: {
      cpus: () => [{ idle: 90, total: 100 }],
      totalmem: () => 8 * 1024 ** 3,
      freemem: () => 2 * 1024 ** 3,
      uptime: () => 7_200,
    },
    now: () => 1_000,
    delay: async () => {},
  };
}

function fakeRunner(stdoutByCommand: (file: string, args: readonly string[]) => string): {
  run: CommandRunner;
  calls: Array<{ file: string; args: readonly string[] }>;
} {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  return {
    calls,
    run: async (file, args) => {
      calls.push({ file, args });
      return { stdout: stdoutByCommand(file, args), stderr: "", exitCode: 0 };
    },
  };
}

function makeEntry(overrides?: {
  run?: CommandRunner;
  spawnFn?: AppsDeps["spawn"];
  stat?: AppsDeps["stat"];
  metrics?: MetricsDeps;
}) {
  return createPcControlHostEntry({
    metrics: overrides?.metrics ?? fakeMetrics(),
    platform: "win32",
    powershellPath: async () => "powershell.exe",
    run: overrides?.run,
    spawnFn: overrides?.spawnFn,
    stat: overrides?.stat,
  });
}

describe("pc-control host entry", () => {
  it("returns a schema-valid system snapshot without running commands", async () => {
    const { run, calls } = fakeRunner(() => CSV);
    const entry = makeEntry({ run });
    const harness = experimental_createHostEntryHarness(entry);
    const snapshot = await harness.experimental_call("systemSnapshot", null);
    expect(() => systemSnapshotSchema.parse(snapshot)).not.toThrow();
    const parsed = systemSnapshotSchema.parse(snapshot);
    expect(parsed.cpuCores).toBe(1);
    expect(parsed.memoryUsedPercent).toBe(75);
    expect(calls).toHaveLength(0);
  });

  it("lists processes through powershell with a constant argv", async () => {
    const { run, calls } = fakeRunner((file) =>
      file === "powershell.exe" ? CSV : "",
    );
    const entry = makeEntry({ run });
    const harness = experimental_createHostEntryHarness(entry);
    const listed = await harness.experimental_call("listProcesses", null);
    expect(calls[0]?.file).toBe("powershell.exe");
    expect(
      calls[0]?.args.some((arg) => arg.includes("Get-Process")),
    ).toBe(true);
    expect(listed.processes).toHaveLength(3);
    expect(listed.processes.map((sample) => sample.pid).sort()).toEqual([
      100, 200, 300,
    ]);
  });

  it("resolves profile matches by name and exe path", async () => {
    const { run } = fakeRunner((file) =>
      file === "powershell.exe" ? CSV : "",
    );
    const entry = makeEntry({ run });
    const harness = experimental_createHostEntryHarness(entry);
    const matches = await harness.experimental_call("resolveProcessMatches", {
      matchers: [
        {
          key: "pcp_tool",
          processName: "Tool",
          exePath: "C:\\Apps\\Tool\\tool.exe",
        },
        {
          key: "pcp_missing",
          processName: "Nothing",
          exePath: "C:\\Nope\\nothing.exe",
        },
        {
          key: "pcp_byotherexe",
          processName: "whatever",
          exePath: "C:\\Elsewhere\\other.exe",
        },
      ],
    });
    expect(matches.matches).toEqual([
      { key: "pcp_tool", pids: [100, 200] },
      { key: "pcp_missing", pids: [] },
      { key: "pcp_byotherexe", pids: [300] },
    ]);
  });

  it("starts an app through the injected spawn with argv only", async () => {
    const spawns: Array<{ file: string; args: readonly string[] }> = [];
    const entry = makeEntry({
      run: fakeRunner(() => CSV).run,
      spawnFn: (file, args) => {
        spawns.push({ file, args });
        return { pid: 4_242, unref: vi.fn() };
      },
      stat: async (target) =>
        target === "C:\\Apps\\Tool\\tool.exe"
          ? { isFile: true, isDirectory: false }
          : target === "C:\\Apps\\Tool"
            ? { isFile: false, isDirectory: true }
            : null,
    });
    const harness = experimental_createHostEntryHarness(entry);
    const started = await harness.experimental_call("startApp", {
      exePath: "C:\\Apps\\Tool\\tool.exe",
      args: ["--verbose"],
      cwd: "C:\\Apps\\Tool",
    });
    expect(started.pid).toBe(4_242);
    expect(spawns).toEqual([
      { file: "C:\\Apps\\Tool\\tool.exe", args: ["--verbose"] },
    ]);
  });

  it("stops matching processes gracefully through taskkill", async () => {
    let alive = true;
    const headerOnly = CSV.split("\r\n")[0] ?? "";
    const { run, calls } = fakeRunner(() => (alive ? CSV : headerOnly));
    const metrics = fakeMetrics();
    const entry = createPcControlHostEntry({
      metrics: {
        ...metrics,
        delay: async () => {
          alive = false;
        },
      },
      platform: "win32",
      powershellPath: async () => "powershell.exe",
      run,
      spawnFn: (() => {
        throw new Error("spawn must not be used");
      }) as unknown as AppsDeps["spawn"],
      stat: async () => null,
    });
    const harness = experimental_createHostEntryHarness(entry);
    const stopped = await harness.experimental_call("stopProcesses", {
      pids: [100],
      processName: "Tool",
      exePath: "C:\\Apps\\Tool\\tool.exe",
    });
    expect(stopped.stoppedCount).toBe(1);
    expect(
      calls.filter((call) => call.file === "taskkill"),
    ).toEqual([{ file: "taskkill", args: ["/PID", "100", "/T"] }]);
  });
});
