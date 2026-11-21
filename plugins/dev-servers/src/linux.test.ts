import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeProcAddress,
  environHidden,
  parseProcNetTcp,
  parseProcStat,
  readLinuxSnapshot,
  threadIdFromEnviron,
} from "./linux.js";

const UID = process.getuid?.() ?? 1000;
const HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

function tcpLine(
  local: string,
  state: string,
  uid: number,
  inode: number,
): string {
  return `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  ${uid}        0 ${inode} 1 0000000000000000 100 0 0 10 0\n`;
}

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fakeProc(
  processes: Array<{
    pid: number;
    ppid: number;
    comm: string;
    environ: string[];
    cmdline?: string[];
    sockets?: number[];
  }>,
  tcp: string,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "dev-servers-proc-"));
  roots.push(root);
  await mkdir(path.join(root, "net"));
  await writeFile(path.join(root, "net", "tcp"), HEADER + tcp);
  for (const entry of processes) {
    const directory = path.join(root, String(entry.pid));
    await mkdir(path.join(directory, "fd"), { recursive: true });
    await writeFile(
      path.join(directory, "stat"),
      `${entry.pid} (${entry.comm} (x)) S ${entry.ppid} 1 1 0 -1\n`,
    );
    await writeFile(path.join(directory, "comm"), `${entry.comm}\n`);
    await writeFile(
      path.join(directory, "cmdline"),
      (entry.cmdline ?? [entry.comm]).map((arg) => `${arg}\0`).join(""),
    );
    await writeFile(
      path.join(directory, "environ"),
      entry.environ.map((value) => `${value}\0`).join(""),
    );
    for (const [index, inode] of (entry.sockets ?? []).entries())
      await symlink(
        `socket:[${inode}]`,
        path.join(directory, "fd", String(index + 3)),
      );
  }
  return root;
}

describe("Linux /proc parsing", () => {
  it("decodes IPv4 and IPv6 socket addresses", () => {
    expect(decodeProcAddress("0100007F")).toBe("127.0.0.1");
    expect(decodeProcAddress("00000000")).toBe("0.0.0.0");
    expect(decodeProcAddress("00000000000000000000000001000000")).toBe("::1");
    expect(decodeProcAddress("00000000000000000000000000000000")).toBe("::");
    expect(decodeProcAddress("0000000000000000FFFF00000100007F")).toBe(
      "::ffff:127.0.0.1",
    );
  });

  it("keeps only listening sockets of the user", () => {
    const listening = parseProcNetTcp(
      HEADER +
        tcpLine("0100007F:1435", "0A", UID, 11) +
        tcpLine("0100007F:1436", "01", UID, 12) +
        tcpLine("0100007F:1437", "0A", UID + 1, 13),
      UID,
    );
    expect([...listening]).toEqual([
      ["11", { port: 5173, address: "127.0.0.1" }],
    ]);
  });

  it("reads the parent from a stat line whose name holds a parenthesis", () => {
    expect(parseProcStat("42 (node (vite)) S 7 42 42 0 -1")).toEqual({
      ppid: 7,
    });
    expect(parseProcStat("garbage")).toBeNull();
  });

  it("treats an environment without variables as hidden", () => {
    expect(environHidden("npm run dev\0\0")).toBe(true);
    expect(environHidden(null)).toBe(true);
    expect(environHidden("A=1\0")).toBe(false);
  });

  it("reads the thread id from the environment", () => {
    expect(threadIdFromEnviron("A=1\0BB_THREAD_ID=thr_x\0B=2\0")).toBe("thr_x");
    expect(threadIdFromEnviron("BB_THREAD_ID=\0")).toBeNull();
    expect(threadIdFromEnviron("A=1\0")).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "maps listening sockets to processes of a thread",
    async () => {
      const root = await fakeProc(
        [
          { pid: 10, ppid: 1, comm: "zsh", environ: ["BB_THREAD_ID=thr_a"] },
          {
            pid: 11,
            ppid: 10,
            comm: "node",
            environ: ["BB_THREAD_ID=thr_a"],
            sockets: [501, 502],
          },
          { pid: 12, ppid: 1, comm: "postgres", environ: [], sockets: [503] },
          {
            pid: 13,
            ppid: 1,
            comm: "node",
            environ: ["BB_THREAD_ID=thr_a"],
            cmdline: ["node", "/usr/lib/node_modules/npm/bin/npx-cli.js", "x"],
          },
        ],
        tcpLine("0100007F:1435", "0A", UID, 501) +
          tcpLine("0100007F:1436", "01", UID, 502) +
          tcpLine("00000000:1538", "0A", UID, 503),
      );
      const snapshot = await readLinuxSnapshot(UID, root);
      expect(snapshot.table.get(11)).toEqual({
        pid: 11,
        ppid: 10,
        name: "node",
        threadId: "thr_a",
        toolCallId: null,
        launcher: false,
      });
      expect(snapshot.table.get(13)?.launcher).toBe(true);
      expect(snapshot.sockets).toEqual([
        { pid: 11, port: 5173, address: "127.0.0.1" },
      ]);
    },
  );
});
