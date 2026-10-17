import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalRelayToMainMessage } from "../../src/terminal-relay/terminal-relay-ipc.js";
import { TerminalRelaySupervisor } from "../../src/terminal-relay/terminal-relay-supervisor.js";
import { testLogger } from "../helpers/test-app.js";

const running: TerminalRelaySupervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((supervisor) => supervisor.stop()));
});

function supervisor(
  onRestart: () => void,
  env: NodeJS.ProcessEnv = process.env,
): TerminalRelaySupervisor {
  const instance = new TerminalRelaySupervisor({
    entryPath: fileURLToPath(
      new URL("../fixtures/terminal-relay-child.mjs", import.meta.url),
    ),
    env,
    execArgv: [],
    execPath: process.execPath,
    logger: testLogger,
    backoff: { initialDelayMs: 25, maxDelayMs: 100, stableRuntimeMs: 5_000 },
    onMessage: () => {},
    onRestart,
  });
  running.push(instance);
  return instance;
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Terminal relay did not recover");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("terminal relay supervision", () => {
  it("gates sends by readiness and restarts after an early crash with increasing delays", async () => {
    const times: number[] = [];
    const instance = supervisor(() => {
      times.push(Date.now());
    });
    expect(instance.isReady()).toBe(false);
    expect(instance.send({ type: "shutdown" })).toBe(false);
    await instance.start();
    expect(instance.isReady()).toBe(true);
    for (let index = 0; index < 2; index++) {
      expect(
        instance.send({ type: "forget-terminal", terminalId: "terminal-1" }),
      ).toBe(true);
      await until(() => !instance.isReady());
      expect(instance.send({ type: "shutdown" })).toBe(false);
      await until(() => times.length === index + 2);
    }
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(25);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(50);
    expect(instance.isReady()).toBe(true);
  });

  it("does not report ready for a child that exits before announcing itself", async () => {
    const restarted = vi.fn();
    const instance = supervisor(restarted, {
      ...process.env,
      BB_TEST_BEFORE_READY: "1",
    });
    expect(instance.send({ type: "shutdown" })).toBe(false);
    void instance.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(instance.isReady()).toBe(false);
    expect(restarted).not.toHaveBeenCalled();
  });

  it("forwards relay warnings to the main process instead of starting a log worker", async () => {
    const messages: TerminalRelayToMainMessage[] = [];
    const instance = new TerminalRelaySupervisor({
      entryPath: fileURLToPath(
        new URL(
          "../../src/terminal-relay/terminal-relay-main.ts",
          import.meta.url,
        ),
      ),
      env: {
        ...process.env,
        BB_DATA_DIR: await mkdtemp(join(tmpdir(), "bb-relay-log-")),
      },
      execArgv: [...process.execArgv, "--conditions=source", "--import", "tsx"],
      execPath: process.execPath,
      logger: testLogger,
      onMessage: (message) => {
        messages.push(message);
      },
      onRestart: () => {},
    });
    running.push(instance);
    await instance.start();
    expect(
      instance.send({
        type: "accept-browser",
        grant: {
          kind: "browser",
          terminalId: "terminal-1",
          sinceSeq: 0,
          outputAcks: true,
        },
        head: "",
        headers: {},
        method: "GET",
        url: "/ws/terminals/terminal-1",
      }),
    ).toBe(true);
    await until(() => messages.some((message) => message.type === "log"));
    expect(messages.find((message) => message.type === "log")).toEqual({
      type: "log",
      message: "Terminal upgrade omitted socket handle",
      details: {},
    });
  }, 15_000);
});
