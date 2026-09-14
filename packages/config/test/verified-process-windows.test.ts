// bb-fork(windows): covers the WMI-backed verified process ops used on Windows.
import { describe, expect, it, vi } from "vitest";
import {
  createWindowsVerifiedProcessOps,
  parseWindowsProcessSnapshot,
  readWindowsProcessSnapshot,
} from "../src/verified-process-windows.js";
import { createNodeVerifiedProcessOps } from "../src/verified-process-stop.js";

describe("parseWindowsProcessSnapshot", () => {
  it("reads the command line and elapsed seconds", () => {
    expect(
      parseWindowsProcessSnapshot(
        '{"command":"node C:\\\\bb\\\\scripts\\\\start-bb.mjs","elapsedSeconds":42}',
      ),
    ).toEqual({
      command: "node C:\\bb\\scripts\\start-bb.mjs",
      elapsedSeconds: 42,
    });
  });

  it("reads the first entry when PowerShell returns an array", () => {
    expect(
      parseWindowsProcessSnapshot('[{"command":"node x","elapsedSeconds":7}]'),
    ).toEqual({ command: "node x", elapsedSeconds: 7 });
  });

  it("keeps a readable field when the other is missing or unusable", () => {
    expect(parseWindowsProcessSnapshot('{"command":"node x"}')).toEqual({
      command: "node x",
      elapsedSeconds: null,
    });
    expect(
      parseWindowsProcessSnapshot('{"command":null,"elapsedSeconds":5}'),
    ).toEqual({ command: null, elapsedSeconds: 5 });
    expect(
      parseWindowsProcessSnapshot('{"command":"","elapsedSeconds":5}'),
    ).toEqual({ command: null, elapsedSeconds: 5 });
  });

  it("rejects negative, fractional, and non-numeric elapsed values", () => {
    expect(
      parseWindowsProcessSnapshot('{"command":"node x","elapsedSeconds":-1}'),
    ).toEqual({ command: "node x", elapsedSeconds: null });
    expect(
      parseWindowsProcessSnapshot('{"command":"node x","elapsedSeconds":"9"}'),
    ).toEqual({ command: "node x", elapsedSeconds: null });
    expect(
      parseWindowsProcessSnapshot('{"command":"node x","elapsedSeconds":1.6}'),
    ).toEqual({ command: "node x", elapsedSeconds: 2 });
  });

  it("returns null when PowerShell printed nothing or something unusable", () => {
    expect(parseWindowsProcessSnapshot("")).toBeNull();
    expect(parseWindowsProcessSnapshot("   ")).toBeNull();
    expect(parseWindowsProcessSnapshot("not json")).toBeNull();
    expect(parseWindowsProcessSnapshot("42")).toBeNull();
    expect(parseWindowsProcessSnapshot("null")).toBeNull();
  });
});

describe("createWindowsVerifiedProcessOps", () => {
  it("serves the command and start time from a single snapshot read", async () => {
    const readSnapshot = vi.fn(async () => ({
      command: "node C:\\bb\\scripts\\start-bb.mjs",
      elapsedSeconds: 90,
    }));
    const ops = createWindowsVerifiedProcessOps({ readSnapshot });

    await expect(ops.readCommand(4_242)).resolves.toBe(
      "node C:\\bb\\scripts\\start-bb.mjs",
    );
    await expect(ops.readElapsedSeconds(4_242)).resolves.toBe(90);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledWith(4_242);
  });

  it("reports unusable fields as null so the caller refuses the process", async () => {
    const ops = createWindowsVerifiedProcessOps({
      readSnapshot: async () => null,
    });

    await expect(ops.readCommand(4_242)).resolves.toBeNull();
    await expect(ops.readElapsedSeconds(4_242)).resolves.toBeNull();
  });

  it("retries a failed snapshot instead of caching the failure", async () => {
    const readSnapshot = vi
      .fn<() => Promise<null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const ops = createWindowsVerifiedProcessOps({ readSnapshot });

    await ops.readCommand(4_242);
    await ops.readElapsedSeconds(4_242);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it("terminates the process tree instead of signalling a single process", () => {
    const terminateTree = vi.fn();
    const ops = createWindowsVerifiedProcessOps({ terminateTree });

    ops.kill(4_242, "SIGTERM");

    expect(terminateTree).toHaveBeenCalledWith(4_242);
  });

  it("waits for an exited process and reports a surviving one", async () => {
    const ops = createWindowsVerifiedProcessOps();

    await expect(
      ops.waitForExit({ pid: 4_242_424, timeoutMs: 50 }),
    ).resolves.toBe(true);
    await expect(
      ops.waitForExit({ pid: process.pid, timeoutMs: 50 }),
    ).resolves.toBe(false);
  });

  it("reports whether a process is alive", () => {
    const ops = createWindowsVerifiedProcessOps();

    expect(ops.isRunning(process.pid)).toBe(true);
    expect(ops.isRunning(4_242_424)).toBe(false);
  });
});

describe("createNodeVerifiedProcessOps", () => {
  it.runIf(process.platform === "win32")(
    "reads native Windows process details through WMI",
    async () => {
      const snapshot = await readWindowsProcessSnapshot(process.pid);

      expect(snapshot?.command).toMatch(/node/i);
      expect(snapshot?.elapsedSeconds).toBeGreaterThanOrEqual(0);

      const command = await createNodeVerifiedProcessOps().readCommand(
        process.pid,
      );
      expect(command).toMatch(/node/i);
    },
  );

  it.runIf(process.platform === "win32")(
    "verifies the running process against its recorded command line",
    async () => {
      const command = await createNodeVerifiedProcessOps().readCommand(
        process.pid,
      );

      expect(command).not.toBeNull();
      expect(command).toContain("node");
    },
  );
});
