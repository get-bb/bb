import { describe, expect, it } from "vitest";
import {
  parseLsofListeners,
  parsePsEnvironment,
  parsePsTable,
  readDarwinSnapshot,
} from "./darwin.js";

describe("macOS process parsing", () => {
  it("reads pid, parent and the executable name of the user's processes", () => {
    const table = parsePsTable(
      "  501     1   501 /bin/zsh\n  777   501   501 /usr/local/bin/node\n  900     1     0 /usr/sbin/sshd\n",
      501,
    );
    expect([...table.values()]).toEqual([
      { pid: 501, ppid: 1, name: "zsh" },
      { pid: 777, ppid: 501, name: "node" },
    ]);
  });

  it("takes the thread id from the environment after the arguments", () => {
    const threads = parsePsEnvironment(
      [
        "  777 node server.js --label BB_THREAD_ID=fake",
        "  778 node other.js",
        "  779 npm run serve",
      ].join("\n"),
      [
        "  777 node server.js --label BB_THREAD_ID=fake PATH=/bin BB_THREAD_ID=thr_real CODEX_TOOL_CALL_ID=exec-9",
        "  778 node other.js PATH=/bin",
        "  779 npm run serve   ",
      ].join("\n"),
    );
    expect([...threads]).toEqual([
      [
        777,
        {
          threadId: "thr_real",
          toolCallId: "exec-9",
          argv: ["node", "server.js"],
          hidden: false,
        },
      ],
      [
        778,
        {
          threadId: null,
          toolCallId: null,
          argv: ["node", "other.js"],
          hidden: false,
        },
      ],
      [
        779,
        {
          threadId: null,
          toolCallId: null,
          argv: ["npm", "run"],
          hidden: true,
        },
      ],
    ]);
  });

  it("gives a process that hides its environment the thread of its parent", async () => {
    const outputs: Record<string, string> = {
      "-axo":
        "  10     1   501 /bin/zsh\n  11    10   501 npm run serve\n  12    11   501 /usr/bin/python3\n",
      "-axww":
        "  10 /bin/zsh -c npm run serve\n  11 npm run serve\n  12 python3 -m http.server\n",
      "-axwwE":
        "  10 /bin/zsh -c npm run serve BB_THREAD_ID=thr_mac\n  11 npm run serve\n  12 python3 -m http.server BB_THREAD_ID=thr_mac\n",
    };
    const snapshot = await readDarwinSnapshot(501, async (command, args) =>
      command === "/usr/sbin/lsof"
        ? "p12\nn127.0.0.1:8000\n"
        : outputs[args[0]!]!,
    );
    expect(snapshot?.table.get(11)).toMatchObject({
      threadId: "thr_mac",
      launcher: true,
    });
  });

  it("treats a process missing from one ps run as hidden", () => {
    const entries = parsePsEnvironment(
      "  10 node a.js\n",
      "  10 node a.js BB_THREAD_ID=thr_x\n  11 node b.js BB_THREAD_ID=thr_x\n",
    );
    expect(entries.get(10)).toMatchObject({ threadId: "thr_x", hidden: false });
    expect(entries.get(11)?.hidden).toBe(true);
  });

  it("reads listening ports for each process", () => {
    expect(
      parseLsofListeners(
        "p777\nf20\nn127.0.0.1:5173\nf21\nn[::1]:5173\np800\nf5\nn*:3000\n",
      ),
    ).toEqual([
      { pid: 777, port: 5173, address: "127.0.0.1" },
      { pid: 777, port: 5173, address: "::1" },
      { pid: 800, port: 3000, address: "0.0.0.0" },
    ]);
  });

  it("gives no snapshot when a tool fails", async () => {
    await expect(
      readDarwinSnapshot(501, async (command) =>
        command === "/usr/sbin/lsof" ? null : "",
      ),
    ).resolves.toBeNull();
  });
});
