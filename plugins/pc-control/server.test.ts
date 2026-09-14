import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createPcControlPlugin } from "./server.js";
import { pcControlHostContract } from "./host-contract.js";
import type { AppProfile } from "./contract.js";

const HOST = "host_1";

interface HostScript {
  method: string;
  output: (input: unknown) => unknown;
}

interface LoadOptions {
  hostScript?: readonly HostScript[];
  hosts?: Array<{ id: string; name: string; status: string }>;
  rpcCalls?: Array<{ method: string; input: unknown }>;
}

const SNAPSHOT = {
  cpuPercent: 12.5,
  cpuCores: 8,
  memoryTotalBytes: 16 * 1024 ** 3,
  memoryUsedBytes: 8 * 1024 ** 3,
  memoryUsedPercent: 50,
  uptimeSeconds: 3_600,
  collectedAt: "2026-09-09T10:00:00.000Z",
};

const PROCESS_LIST = {
  collectedAt: "2026-09-09T10:00:00.000Z",
  truncated: false,
  processes: [
    { pid: 100, name: "Tool", cpuPercent: 40, memoryBytes: 100 * 1024 ** 2 },
    { pid: 200, name: "Tool", cpuPercent: 10, memoryBytes: 900 * 1024 ** 2 },
    { pid: 300, name: "browser", cpuPercent: 20, memoryBytes: 400 * 1024 ** 2 },
  ],
};

async function loadPlugin(options: LoadOptions = {}) {
  const hostCalls: Array<{ method: string; input: unknown; hostId: string }> =
    [];
  const hosts =
    options.hosts ?? [{ id: HOST, name: "Office PC", status: "connected" }];
  const host = createFakePluginHost({
    pluginId: "pc-control",
    sdk: {
      hosts: {
        list: async () => hosts,
      },
    },
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      hostCalls.push({ method, input, hostId });
      const entry = options.hostScript?.find(
        (candidate) => candidate.method === method,
      );
      if (entry === undefined) {
        throw new Error(`unexpected host rpc "${method}"`);
      }
      return entry.output(input);
    },
  });
  await createPcControlPlugin()(host.bb);
  return {
    bb: host.bb as BbPluginApi,
    harness: host.harness,
    hostCalls,
  };
}

const MATCH_SCRIPT: HostScript[] = [
  {
    method: "resolveProcessMatches",
    output: (input) => {
      const matchers = (
        input as { matchers: Array<{ key: string; processName: string }> }
      ).matchers;
      return {
        matches: matchers.map((matcher, index) => ({
          key: matcher.key,
          pids:
            matcher.processName.toLowerCase() === "tool" && index === 0
              ? [555]
              : [],
        })),
      };
    },
  },
];

async function seedProfile(
  harness: ReturnType<typeof createFakePluginHost>["harness"],
  overrides?: Partial<Record<string, unknown>>,
): Promise<AppProfile> {
  const result = (await harness.callRpc("saveProfile", {
    name: "Tool",
    exePath: "C:\\Apps\\Tool\\tool.exe",
    args: ["--port", "8080"],
    ...overrides,
  })) as { profile: AppProfile };
  return result.profile;
}

describe("pc-control server rpc", () => {
  it("returns the snapshot with the connected host summary", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "systemSnapshot", output: () => SNAPSHOT },
      ],
    });
    const overview = (await harness.callRpc("overview", null)) as {
      host: { id: string; name: string; status: string };
      snapshot: typeof SNAPSHOT | null;
      error: string | null;
    };
    expect(overview.host).toEqual({
      id: HOST,
      name: "Office PC",
      status: "connected",
    });
    expect(overview.snapshot?.cpuPercent).toBe(12.5);
    expect(overview.error).toBeNull();
  });

  it("prefers the connected host and reports host failures without throwing", async () => {
    const { harness, hostCalls } = await loadPlugin({
      hosts: [
        { id: "host_offline", name: "Laptop", status: "disconnected" },
        { id: HOST, name: "Office PC", status: "connected" },
      ],
      hostScript: [
        {
          method: "systemSnapshot",
          output: () => {
            throw new Error("daemon unreachable");
          },
        },
      ],
    });
    const overview = (await harness.callRpc("overview", null)) as {
      error: string | null;
      snapshot: unknown;
    };
    expect(overview.error).toBe("daemon unreachable");
    expect(overview.snapshot).toBeNull();
    expect(hostCalls[0]?.hostId).toBe(HOST);
  });

  it("fails with an actionable error when no host is enrolled", async () => {
    const { harness } = await loadPlugin({ hosts: [] });
    await expect(harness.callRpc("overview", null)).rejects.toThrow(
      /No machine is enrolled/u,
    );
  });

  it("sorts, filters, and limits the process list", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "listProcesses", output: () => PROCESS_LIST },
      ],
    });
    const byCpu = (await harness.callRpc("processes", {
      sortBy: "cpu",
      limit: 2,
    })) as {
      processes: Array<{ pid: number }>;
      totalMatched: number;
    };
    expect(byCpu.processes.map((process) => process.pid)).toEqual([100, 300]);
    expect(byCpu.totalMatched).toBe(3);
    const byMemory = (await harness.callRpc("processes", {
      sortBy: "memory",
      limit: 10,
      query: "tool",
    })) as { processes: Array<{ pid: number }> };
    expect(byMemory.processes.map((process) => process.pid)).toEqual([200, 100]);
  });

  it("returns a host error instead of throwing when listing fails", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        {
          method: "listProcesses",
          output: () => {
            throw new Error("powershell missing");
          },
        },
      ],
    });
    const result = (await harness.callRpc("processes", {
      sortBy: "cpu",
      limit: 10,
    })) as { hostError: string | null; processes: unknown[] };
    expect(result.hostError).toBe("powershell missing");
    expect(result.processes).toEqual([]);
  });

  it("saves profiles with derived defaults and persists them", async () => {
    const { harness } = await loadPlugin();
    const created = await seedProfile(harness);
    expect(created.id).toMatch(/^pcp_[0-9a-z]{6,16}$/u);
    expect(created.cwd).toBe("C:\\Apps\\Tool");
    expect(created.processName).toBeNull();
    const listed = (await harness.callRpc("profiles", null)) as {
      profiles: AppProfile[];
    };
    expect(listed.profiles).toHaveLength(1);
    expect(listed.profiles[0]?.name).toBe("Tool");
  });

  it("rejects duplicate names and invalid fields", async () => {
    const { harness } = await loadPlugin();
    await seedProfile(harness);
    await expect(
      harness.callRpc("saveProfile", {
        name: "tool",
        exePath: "C:\\Other\\other.exe",
        args: [],
      }),
    ).rejects.toThrow(/already exists/u);
    await expect(
      harness.callRpc("saveProfile", {
        name: "Bad",
        exePath: "relative.exe",
        args: [],
      }),
    ).rejects.toThrow(/absolute/u);
    await expect(
      harness.callRpc("saveProfile", {
        name: "Bad",
        exePath: "C:\\Other\\other.exe",
        args: ["\x01bad"],
      }),
    ).rejects.toThrow(/control/u);
  });

  it("merges live process status into profiles", async () => {
    const { harness } = await loadPlugin({
      hostScript: MATCH_SCRIPT,
    });
    await seedProfile(harness);
    await seedProfile(harness, {
      name: "Stopped tool",
      exePath: "C:\\Apps\\Stopped\\stopped.exe",
      id: undefined,
    });
    const second = (await harness.callRpc("profiles", null)) as {
      profiles: Array<{ id: string; name: string }>;
    };
    const stoppedProfile = second.profiles.find(
      (profile) => profile.name === "Stopped tool",
    );
    expect(stoppedProfile).toBeDefined();
    const again = (await harness.callRpc("profiles", null)) as {
      profiles: Array<{
        name: string;
        status: { running: boolean; pids: number[] };
      }>;
    };
    const tool = again.profiles.find((profile) => profile.name === "Tool");
    const stopped = again.profiles.find(
      (profile) => profile.name === "Stopped tool",
    );
    expect(tool?.status).toEqual({ running: true, pids: [555] });
    expect(stopped?.status).toEqual({ running: false, pids: [] });
  });

  it("starts, stops, and restarts only existing profiles", async () => {
    const { harness, hostCalls } = await loadPlugin({
      hostScript: [
        { method: "resolveProcessMatches", output: MATCH_SCRIPT[0]!.output },
        { method: "startApp", output: () => ({ pid: 4_242 }) },
        { method: "stopProcesses", output: () => ({ stoppedCount: 1 }) },
      ],
    });
    const profile = await seedProfile(harness);
    await expect(
      harness.callRpc("startProfile", { id: "pcp_missing" }),
    ).rejects.toThrow(/Unknown profile/u);
    const started = (await harness.callRpc("startProfile", {
      id: profile.id,
    })) as { pid: number };
    expect(started.pid).toBe(4_242);
    const startCall = hostCalls.find((call) => call.method === "startApp");
    expect(startCall?.input).toEqual({
      exePath: "C:\\Apps\\Tool\\tool.exe",
      args: ["--port", "8080"],
      cwd: "C:\\Apps\\Tool",
    });
    const stopped = (await harness.callRpc("stopProfile", {
      id: profile.id,
    })) as { stoppedCount: number };
    expect(stopped.stoppedCount).toBe(1);
    const stopCall = hostCalls.find((call) => call.method === "stopProcesses");
    expect(stopCall?.input).toMatchObject({
      pids: [555],
      processName: "tool",
      exePath: "C:\\Apps\\Tool\\tool.exe",
    });
    const restarted = (await harness.callRpc("restartProfile", {
      id: profile.id,
    })) as { pid: number };
    expect(restarted.pid).toBe(4_242);
    const mutationMethods = hostCalls
      .filter((call) => call.method === "startApp" || call.method === "stopProcesses")
      .map((call) => call.method);
    expect(mutationMethods).toEqual([
      "startApp",
      "stopProcesses",
      "stopProcesses",
      "startApp",
    ]);
  });

  it("deletes profiles and rejects unknown ids", async () => {
    const { harness } = await loadPlugin();
    const profile = await seedProfile(harness);
    await expect(
      harness.callRpc("deleteProfile", { id: "pcp_missing" }),
    ).rejects.toThrow(/no longer exists/u);
    await harness.callRpc("deleteProfile", { id: profile.id });
    const listed = (await harness.callRpc("profiles", null)) as {
      profiles: unknown[];
    };
    expect(listed.profiles).toHaveLength(0);
  });
});

describe("bb pc cli", () => {
  it("prints usage without a subcommand", async () => {
    const { harness } = await loadPlugin();
    const result = await harness.runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bb pc status");
  });

  it("prints a human-readable status", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "systemSnapshot", output: () => SNAPSHOT },
      ],
    });
    const result = await harness.runCli(["status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Office PC");
    expect(result.stdout).toContain("CPU: 12.5%");
    expect(result.stdout).toContain("Memory:");
    expect(result.stdout).toContain("Uptime: 1h 0m");
    expect(result.stdout).not.toContain("Network");
    expect(result.stdout).not.toContain("Pagefile");
    expect(result.stdout).not.toContain("Disks:");
  });

  it("prints json status", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "systemSnapshot", output: () => SNAPSHOT },
      ],
    });
    const result = await harness.runCli(["status", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { snapshot: unknown };
    expect(parsed.snapshot).toEqual(SNAPSHOT);
  });

  it("lists processes with sorting options", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "listProcesses", output: () => PROCESS_LIST },
      ],
    });
    const result = await harness.runCli([
      "processes",
      "--sort",
      "memory",
      "--limit",
      "2",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("200");
    expect(result.stdout).toContain("3 matched; showing 2.");
    const bad = await harness.runCli(["processes", "--sort", "bogus"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("--sort must be");
  });

  it("lists saved apps with running status", async () => {
    const { harness } = await loadPlugin({
      hostScript: MATCH_SCRIPT,
    });
    const profile = await seedProfile(harness);
    const result = await harness.runCli(["apps"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(profile.id);
    expect(result.stdout).toContain("running (555)");
  });

  it("starts and stops by name or id and refuses unknown profiles", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "resolveProcessMatches", output: MATCH_SCRIPT[0]!.output },
        { method: "startApp", output: () => ({ pid: 99 }) },
        { method: "stopProcesses", output: () => ({ stoppedCount: 1 }) },
      ],
    });
    const profile = await seedProfile(harness);
    const started = await harness.runCli(["start", "Tool"]);
    expect(started.exitCode).toBe(0);
    expect(started.stdout).toContain("Started Tool (pid 99)");
    const stopped = await harness.runCli(["stop", profile.id]);
    expect(stopped.exitCode).toBe(0);
    expect(stopped.stdout).toContain("Stopped Tool (1 process)");
    const unknown = await harness.runCli(["restart", "no-such-profile"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('Unknown profile "no-such-profile"');
  });

  it("restarts an existing profile end to end", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "resolveProcessMatches", output: MATCH_SCRIPT[0]!.output },
        { method: "startApp", output: () => ({ pid: 7 }) },
        { method: "stopProcesses", output: () => ({ stoppedCount: 1 }) },
      ],
    });
    await seedProfile(harness);
    const result = await harness.runCli(["restart", "Tool"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Restarted Tool (pid 7)");
  });
});
