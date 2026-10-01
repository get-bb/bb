import { HOST_DAEMON_RESTART_EXIT_CODE } from "@bb/config/machine-service";
import { describe, expect, it } from "vitest";
import {
  superviseHostDaemonProcess,
  type ManagedProcessRun,
  type ProcessExitResult,
} from "../src/launcher.js";

function exitedRun(result: ProcessExitResult): ManagedProcessRun {
  return {
    exit: Promise.resolve({ processName: "daemon", result }),
    async terminate() {},
  };
}

function code(value: number): ProcessExitResult {
  return { code: value, signal: null };
}

function supervise(args: {
  exits: ProcessExitResult[];
  uptimesMs?: number[];
  isShutdownRequested?: () => boolean;
}) {
  const [first, ...rest] = args.exits;
  if (first === undefined) throw new Error("Expected at least one exit");
  const remaining = [...rest];
  const uptimes = [...(args.uptimesMs ?? [])];
  const delays: number[] = [];
  let clock = 0;
  let starts = 0;
  const result = superviseHostDaemonProcess({
    firstRun: exitedRun(first),
    startDaemon: () => {
      starts += 1;
      const next = remaining.shift();
      if (next === undefined) throw new Error("Unexpected daemon restart");
      return exitedRun(next);
    },
    delayMilliseconds: async ({ ms }) => {
      delays.push(ms);
    },
    isShutdownRequested: args.isShutdownRequested ?? (() => false),
    now: () => {
      clock += uptimes.shift() ?? 0;
      return clock;
    },
  });
  return { result, delays, starts: () => starts };
}

describe("superviseHostDaemonProcess", () => {
  it("does not restart a daemon that stopped on purpose", async () => {
    const run = supervise({ exits: [code(0)] });

    await expect(run.result).resolves.toEqual(code(0));
    expect(run.starts()).toBe(0);
  });

  it("restarts a crashed daemon with a growing delay capped at 30 seconds", async () => {
    const run = supervise({
      exits: [
        code(1),
        { code: null, signal: "SIGKILL" },
        code(1),
        code(1),
        code(1),
        code(1),
        code(1),
        code(0),
      ],
    });

    await expect(run.result).resolves.toEqual(code(0));
    expect(run.delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });

  it("restarts at once after a self-update without growing the crash delay", async () => {
    const run = supervise({
      exits: [
        code(HOST_DAEMON_RESTART_EXIT_CODE),
        code(1),
        code(HOST_DAEMON_RESTART_EXIT_CODE),
        code(1),
        code(0),
      ],
    });

    await expect(run.result).resolves.toEqual(code(0));
    expect(run.delays).toEqual([0, 1_000, 0, 2_000]);
  });

  it("returns to the shortest delay once a restarted daemon stays up", async () => {
    const run = supervise({
      exits: [code(1), code(1), code(1), code(0)],
      uptimesMs: [0, 0, 0, 0, 0, 60_000],
    });

    await expect(run.result).resolves.toEqual(code(0));
    expect(run.delays).toEqual([1_000, 2_000, 1_000]);
  });

  it("stops restarting once shutdown is requested", async () => {
    let shuttingDown = false;
    const run = supervise({
      exits: [code(1)],
      isShutdownRequested: () => shuttingDown,
    });
    shuttingDown = true;

    await expect(run.result).resolves.toEqual(code(1));
    expect(run.starts()).toBe(0);
  });
});
