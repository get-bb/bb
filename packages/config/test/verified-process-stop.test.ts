import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it, onTestFinished } from "vitest";
import {
  isProcessRunning,
  stopVerifiedProcess,
} from "../src/verified-process-stop.js";

it("verifies a real process's command and start time before stopping it", async () => {
  const token = `bb-process-identity-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'setInterval(() => {}, 1000); process.stdout.write("ready");',
      token,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  onTestFinished(async () => {
    child.kill("SIGKILL");
    await closed;
  });
  await once(child.stdout, "data");
  if (child.pid === undefined) throw new Error("Child did not start");
  const args = {
    pid: child.pid,
    startedAt,
    signal: "SIGTERM" as const,
    timeoutMs: 2_000,
    killTimeoutMs: 2_000,
    verifyTokens: [token],
  };
  await expect(
    stopVerifiedProcess({ ...args, verifyTokens: ["wrong-token"] }),
  ).resolves.toMatchObject({ kind: "unverified", reason: "command" });
  expect(isProcessRunning(child.pid)).toBe(true);
  await expect(
    stopVerifiedProcess({ ...args, startedAt: "2000-01-01T00:00:00Z" }),
  ).resolves.toMatchObject({ kind: "unverified", reason: "start-time" });
  expect(isProcessRunning(child.pid)).toBe(true);
  await expect(stopVerifiedProcess(args)).resolves.toEqual({
    kind: "stopped",
    usedKill: false,
  });
  expect(isProcessRunning(child.pid)).toBe(false);
}, 90_000);
