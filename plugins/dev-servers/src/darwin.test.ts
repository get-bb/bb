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
        "  777 node server.js --label BB_THREAD_ID=fake PATH=/bin BB_THREAD_ID=thr_real",
        "  778 node other.js PATH=/bin",
      ].join("\n"),
    );
    expect([...threads]).toEqual([
      [777, { threadId: "thr_real", argv: ["node", "server.js"] }],
      [778, { threadId: null, argv: ["node", "other.js"] }],
    ]);
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
