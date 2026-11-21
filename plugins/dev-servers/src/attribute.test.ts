import { describe, expect, it } from "vitest";
import {
  attributeServers,
  descendants,
  inheritHiddenEnvironment,
  isLauncher,
  type ListeningSocket,
  type ProcessEntry,
} from "./attribute.js";

const DAEMON = 100;
const THREAD = "thr_one";

function table(
  entries: Array<[number, number, string, string | null, string?]>,
) {
  return new Map<number, ProcessEntry>(
    entries.map(([pid, ppid, name, threadId, toolCallId]) => [
      pid,
      {
        pid,
        ppid,
        name,
        threadId,
        toolCallId: toolCallId ?? null,
        launcher: isLauncher(name, []),
      },
    ]),
  );
}

const processes = table([
  [1, 0, "systemd", null],
  [50, 1, "login", null],
  [DAEMON, 50, "node", null],
  [110, DAEMON, "node", null],
  [120, 110, "claude", THREAD],
  [121, 120, "node", THREAD],
  [130, 120, "zsh", THREAD],
  [140, 130, "npm", THREAD],
  [141, 140, "node", THREAD],
  [150, 1, "node", THREAD],
  [160, 1, "python3", "thr_two"],
  [170, 130, "bash", THREAD],
  [171, 170, "vite", THREAD],
]);

function sockets(...entries: Array<[number, number]>): ListeningSocket[] {
  return entries.map(([pid, port]) => ({ pid, port, address: "127.0.0.1" }));
}

describe("attributeServers", () => {
  it("roots a server at the command its thread's shell started", () => {
    expect(
      attributeServers({
        table: processes,
        sockets: sockets([141, 5173], [141, 24678]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([
      {
        threadId: THREAD,
        rootPid: 140,
        pids: [141],
        ports: [
          { port: 5173, address: "127.0.0.1" },
          { port: 24678, address: "127.0.0.1" },
        ],
      },
    ]);
  });

  it("roots at the command below the nearest shell when shells nest", () => {
    const [server] = attributeServers({
      table: processes,
      sockets: sockets([171, 3000]),
      daemonPid: DAEMON,
      threadId: THREAD,
    });
    expect(server?.rootPid).toBe(171);
  });

  it("keeps a server that outlived its shell", () => {
    const [server] = attributeServers({
      table: processes,
      sockets: sockets([150, 8080]),
      daemonPid: DAEMON,
      threadId: THREAD,
    });
    expect(server?.rootPid).toBe(150);
  });

  it("never lists the agent or a server the agent started without a shell", () => {
    expect(
      attributeServers({
        table: processes,
        sockets: sockets([120, 41000], [121, 41001]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([]);
  });

  it("never lists a process the daemon runs under", () => {
    const above = table([
      [1, 0, "systemd", null],
      [20, 1, "zsh", THREAD],
      [30, 20, "bb", THREAD],
      [DAEMON, 30, "node", THREAD],
    ]);
    expect(
      attributeServers({
        table: above,
        sockets: sockets([30, 38888]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([]);
  });

  it("skips processes without a thread and filters by thread", () => {
    const all = attributeServers({
      table: processes,
      sockets: sockets([160, 9000], [141, 5173], [110, 38888]),
      daemonPid: DAEMON,
      threadId: null,
    });
    expect(all.map((server) => server.threadId)).toEqual([THREAD, "thr_two"]);
    expect(
      attributeServers({
        table: processes,
        sockets: sockets([160, 9000], [141, 5173]),
        daemonPid: DAEMON,
        threadId: "thr_two",
      }).map((server) => server.rootPid),
    ).toEqual([160]);
  });
});

describe("agents without the thread variable", () => {
  const codex = table([
    [1, 0, "systemd", null],
    [DAEMON, 1, "node", null],
    [110, DAEMON, "node", null],
    [120, 110, "codex", null],
    [130, 120, "npm", THREAD],
    [131, 130, "sh", THREAD],
    [132, 131, "vite", THREAD],
    [140, 120, "python3", THREAD],
  ]);

  it("roots a command whose shell replaced itself with the command", () => {
    expect(
      attributeServers({
        table: codex,
        sockets: sockets([132, 5173], [140, 8000]),
        daemonPid: DAEMON,
        threadId: THREAD,
      }).map((server) => server.rootPid),
    ).toEqual([130, 140]);
  });
});

describe("tool calls", () => {
  const codex = table([
    [1, 0, "systemd", null],
    [DAEMON, 1, "node", null],
    [110, DAEMON, "node", null],
    [120, 110, "codex", THREAD],
    [130, 120, "python3", THREAD, "exec-1"],
    [140, 120, "node", THREAD],
    [150, 120, "bash", THREAD, "exec-2"],
    [151, 150, "npm", THREAD, "exec-2"],
    [152, 151, "sh", THREAD, "exec-2"],
    [153, 152, "vite", THREAD, "exec-2"],
  ]);

  it("roots a command the agent started without a shell at that command", () => {
    expect(
      attributeServers({
        table: codex,
        sockets: sockets([130, 8000], [140, 3845], [153, 5173]),
        daemonPid: DAEMON,
        threadId: THREAD,
      }).map((server) => server.rootPid),
    ).toEqual([151, 130]);
  });
});

describe("agents the bridge started through a launcher or with a tool-call id", () => {
  it("never lists an agent under a hidden npm exec that inherited no thread", () => {
    const npxAgent = table([
      [1, 0, "launchd", null],
      [DAEMON, 1, "node", null],
      [110, DAEMON, "node", null],
      [200, 110, "npm exec @zed/agent", null],
      [201, 200, "sh", THREAD],
      [202, 201, "node", THREAD],
      [203, 202, "chrome", THREAD],
    ]);
    expect(
      attributeServers({
        table: npxAgent,
        sockets: sockets([202, 4096], [203, 9222]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([]);
  });

  it("never lists an agent that inherited the tool-call id of its server", () => {
    const nested = table([
      [1, 0, "systemd", null],
      [DAEMON, 1, "node", null],
      [110, DAEMON, "node", null],
      [120, 110, "codex", THREAD, "exec-outer"],
      [130, 120, "node", THREAD, "exec-outer"],
    ]);
    expect(
      attributeServers({
        table: nested,
        sockets: sockets([130, 3845]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([]);
  });

  it("never lists an agent that the bridge started through a shell", () => {
    const shelled = table([
      [1, 0, "systemd", null],
      [DAEMON, 1, "node", null],
      [110, DAEMON, "node", null],
      [115, 110, "sh", THREAD],
      [120, 115, "agent", THREAD],
    ]);
    expect(
      attributeServers({
        table: shelled,
        sockets: sockets([120, 4096]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([]);
  });

  it("prefers the shell rule over the tool-call id", () => {
    const codexShell = table([
      [1, 0, "systemd", null],
      [DAEMON, 1, "node", null],
      [110, DAEMON, "node", null],
      [120, 110, "codex", null],
      [150, 120, "bash", THREAD, "exec-2"],
      [151, 150, "npm", THREAD, "exec-2"],
      [152, 151, "sh", THREAD, "exec-2"],
      [153, 152, "vite", THREAD, "exec-2"],
    ]);
    const [server] = attributeServers({
      table: codexShell,
      sockets: sockets([153, 5173]),
      daemonPid: DAEMON,
      threadId: THREAD,
    });
    expect(server?.rootPid).toBe(151);
  });
});

describe("launchers", () => {
  const npx = table([
    [1, 0, "systemd", null],
    [DAEMON, 1, "node", null],
    [110, DAEMON, "node", null],
    [300, 110, "npm exec opencode", THREAD],
    [301, 300, "sh", THREAD],
    [302, 301, "opencode", THREAD],
    [310, 302, "bash", THREAD],
    [320, 310, "npm run dev", THREAD],
    [321, 320, "sh", THREAD],
    [322, 321, "vite", THREAD],
    [500, 302, "npm exec @playwright/mcp", THREAD],
    [501, 500, "sh", THREAD],
    [503, 501, "chrome", THREAD],
  ]);

  it("never lists an agent or an MCP server that a package runner started", () => {
    expect(
      attributeServers({
        table: npx,
        sockets: sockets([302, 4096], [503, 9222]),
        daemonPid: DAEMON,
        threadId: null,
      }),
    ).toEqual([]);
  });

  it("roots npm run dev at npm, past the shell npm starts", () => {
    const [server] = attributeServers({
      table: npx,
      sockets: sockets([322, 5173]),
      daemonPid: DAEMON,
      threadId: THREAD,
    });
    expect(server?.rootPid).toBe(320);
  });

  it("recognizes package runners by name or script", () => {
    expect(
      isLauncher("node", [
        "/usr/bin/node",
        "/usr/lib/node_modules/npm/bin/npx-cli.js",
      ]),
    ).toBe(true);
    expect(isLauncher("pnpm", [])).toBe(true);
    expect(isLauncher("node", ["node", "server.js"])).toBe(false);
    expect(isLauncher("npmish", [])).toBe(false);
  });
});

describe("inheritHiddenEnvironment", () => {
  it("fills hidden environments from the nearest visible ancestor", () => {
    const hiddenTable = table([
      [1, 0, "launchd", null],
      [10, 1, "zsh", THREAD],
      [11, 10, "npm run dev", null],
      [12, 11, "node", null],
      [20, 1, "postgres", null],
      [21, 20, "postgres", null],
    ]);
    inheritHiddenEnvironment(hiddenTable, new Set([11, 12, 21]));
    expect(hiddenTable.get(11)?.threadId).toBe(THREAD);
    expect(hiddenTable.get(12)?.threadId).toBe(THREAD);
    expect(hiddenTable.get(21)?.threadId).toBeNull();
  });
});

describe("descendants", () => {
  it("returns the root and every process under it", () => {
    expect(descendants(processes, 130).sort((a, b) => a - b)).toEqual([
      130, 140, 141, 170, 171,
    ]);
  });
});
