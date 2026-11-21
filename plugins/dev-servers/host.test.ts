import { describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import {
  createDevServersHostEntry,
  stopDevServer,
  type DevServersHostDependencies,
} from "./host.js";
import type { ProcessEntry } from "./src/attribute.js";

const DAEMON = 100;
const WORKER = 101;
const THREAD = "thr_one";
const STARTED_AT = 1_700_000_000_000;

function entry(
  pid: number,
  ppid: number,
  name: string,
  threadId: string | null,
): [number, ProcessEntry] {
  return [
    pid,
    { pid, ppid, name, threadId, toolCallId: null, launcher: false },
  ];
}

function createDeps(
  options: { survivesTerm?: number[]; reusedAfterTerm?: number[] } = {},
) {
  const table = new Map<number, ProcessEntry>([
    entry(1, 0, "systemd", null),
    entry(DAEMON, 1, "node", null),
    entry(WORKER, DAEMON, "node", null),
    entry(110, DAEMON, "node", null),
    entry(120, 110, "claude", THREAD),
    entry(130, 120, "zsh", THREAD),
    entry(140, 130, "npm", THREAD),
    entry(141, 140, "node", THREAD),
    entry(142, 141, "esbuild", THREAD),
    entry(150, 130, "sleep", THREAD),
  ]);
  const alive = new Set(table.keys());
  const signals: Array<[number, string]> = [];
  const deps: DevServersHostDependencies = {
    selfPid: WORKER,
    daemonPid: DAEMON,
    readSnapshot: async () => ({
      table,
      sockets: [{ pid: 141, port: 5173, address: "127.0.0.1" }],
    }),
    readCwd: async () => "/work/app",
    readIdentity: async (pid) =>
      pid === 140
        ? { command: "npm run dev", startedAt: STARTED_AT }
        : {
            command: pid === 141 ? "node node_modules/.bin/vite" : null,
            startedAt:
              signals.some(([signalled]) => signalled === pid) &&
              options.reusedAfterTerm?.includes(pid)
                ? STARTED_AT + 3_600_000
                : STARTED_AT + pid,
          },
    kill: (pid, signal) => {
      if (!alive.has(pid)) throw new Error("ESRCH");
      if (signal === 0) return;
      signals.push([pid, signal]);
      if (signal === "SIGKILL" || !options.survivesTerm?.includes(pid))
        alive.delete(pid);
    },
    sleep: async () => {},
  };
  return { deps, signals, alive };
}

describe("dev servers host entry", () => {
  it("lists a thread's server with its command, directory and start time", async () => {
    const { deps } = createDeps();
    const harness = experimental_createHostEntryHarness(
      createDevServersHostEntry(deps),
    );
    await expect(
      harness.experimental_call("list", { threadId: THREAD }),
    ).resolves.toEqual({
      supported: true,
      servers: [
        {
          threadId: THREAD,
          rootPid: 140,
          startedAt: STARTED_AT,
          command: "node node_modules/.bin/vite",
          cwd: "/work/app",
          ports: [{ port: 5173, address: "127.0.0.1" }],
        },
      ],
    });
  });

  it("reports an unsupported platform", async () => {
    const harness = experimental_createHostEntryHarness(
      createDevServersHostEntry(null),
    );
    await expect(
      harness.experimental_call("list", { threadId: null }),
    ).resolves.toEqual({ supported: false, servers: [] });
  });

  it("stops the command and everything under it, and nothing else", async () => {
    const { deps, signals, alive } = createDeps();
    await expect(
      stopDevServer(deps, {
        threadId: THREAD,
        rootPid: 140,
        startedAt: STARTED_AT,
      }),
    ).resolves.toEqual({ stopped: true });
    expect(signals).toEqual([
      [140, "SIGTERM"],
      [141, "SIGTERM"],
      [142, "SIGTERM"],
    ]);
    expect([...alive].sort((a, b) => a - b)).toEqual([
      1,
      DAEMON,
      WORKER,
      110,
      120,
      130,
      150,
    ]);
  });

  it("kills what survives the grace period", async () => {
    const { deps, signals } = createDeps({ survivesTerm: [141] });
    await stopDevServer(deps, {
      threadId: THREAD,
      rootPid: 140,
      startedAt: STARTED_AT,
    });
    expect(signals).toContainEqual([141, "SIGKILL"]);
    expect(signals).not.toContainEqual([140, "SIGKILL"]);
  });

  it("refuses a pid that is not a server of the thread or was reused", async () => {
    const { deps, signals } = createDeps();
    for (const input of [
      { threadId: THREAD, rootPid: 120, startedAt: null },
      { threadId: THREAD, rootPid: 150, startedAt: null },
      { threadId: "thr_other", rootPid: 140, startedAt: STARTED_AT },
      { threadId: THREAD, rootPid: 140, startedAt: STARTED_AT + 60_000 },
      { threadId: THREAD, rootPid: 140, startedAt: null },
    ]) {
      await expect(stopDevServer(deps, input)).resolves.toEqual({
        stopped: false,
      });
    }
    expect(signals).toEqual([]);
  });

  it("accepts the small drift in a process start time between two reads", async () => {
    const { deps } = createDeps();
    await expect(
      stopDevServer(deps, {
        threadId: THREAD,
        rootPid: 140,
        startedAt: STARTED_AT - 7,
      }),
    ).resolves.toEqual({ stopped: true });
  });

  it("does not kill a process that took a stopped server's pid", async () => {
    const { deps, signals } = createDeps({
      survivesTerm: [141],
      reusedAfterTerm: [141],
    });
    await stopDevServer(deps, {
      threadId: THREAD,
      rootPid: 140,
      startedAt: STARTED_AT,
    });
    expect(signals).not.toContainEqual([141, "SIGKILL"]);
  });
});
