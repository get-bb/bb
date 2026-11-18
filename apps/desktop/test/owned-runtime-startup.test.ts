import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { waitForProcessExit } from "@bb/config/child-process-exit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForOwnedRuntimeStartup } from "../src/owned-runtime-startup.js";
import {
  type ServerProbeFetch,
  waitForCompatibleServer,
} from "../src/server-probe.js";

const SLOW_SERVER_SOURCE = `
const { createServer } = require("node:http");
const [port, listenAfterMs, exitAfterMs] = process.argv.slice(1).map(Number);
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    request.url === "/health"
      ? JSON.stringify({ ok: true })
      : JSON.stringify({ hostDaemonPort: 4242, voiceTranscriptionEnabled: false }),
  );
});
if (exitAfterMs > 0) setTimeout(() => process.exit(3), exitAfterMs);
else setTimeout(() => server.listen(port, "127.0.0.1"), listenAfterMs);
`;

interface SlowServerArgs {
  exitAfterMs: number;
  listenAfterMs: number;
}

const children: ChildProcess[] = [];

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
  });
  return address.port;
}

function spawnSlowServer(port: number, args: SlowServerArgs): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      "-e",
      SLOW_SERVER_SOURCE,
      String(port),
      String(args.listenAfterMs),
      String(args.exitAfterMs),
    ],
    { stdio: "ignore" },
  );
  children.push(child);
  return child;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = waitForProcessExit(child);
      child.kill("SIGKILL");
      await exited;
    }
  }
});

describe("waitForOwnedRuntimeStartup", () => {
  it("waits for a slow server, shows the slow-start state, and never stops it", async () => {
    const port = await reservePort();
    const child = spawnSlowServer(port, { exitAfterMs: 0, listenAfterMs: 600 });
    const onSlowStart = vi.fn();

    const startup = await waitForOwnedRuntimeStartup({
      exit: waitForProcessExit(child),
      onSlowStart,
      slowStartNoticeMs: 100,
      waitForServer: (signal) =>
        waitForCompatibleServer({
          intervalMs: 25,
          serverUrl: `http://127.0.0.1:${port}`,
          signal,
        }),
    });

    expect(startup).toEqual({
      kind: "server-probe",
      result: {
        dataDir: null,
        kind: "compatible",
        serverUrl: `http://127.0.0.1:${port}`,
      },
    });
    expect(onSlowStart).toHaveBeenCalledOnce();
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });

  it("fails only when the process exits, and stops probing afterwards", async () => {
    const port = await reservePort();
    const child = spawnSlowServer(port, { exitAfterMs: 300, listenAfterMs: 0 });
    let probes = 0;
    const fetchImpl: ServerProbeFetch = (input, init) => {
      probes += 1;
      return fetch(input, init);
    };
    const onSlowStart = vi.fn();

    const startup = await waitForOwnedRuntimeStartup({
      exit: waitForProcessExit(child),
      onSlowStart,
      slowStartNoticeMs: 60_000,
      waitForServer: (signal) =>
        waitForCompatibleServer({
          fetchImpl,
          intervalMs: 25,
          serverUrl: `http://127.0.0.1:${port}`,
          signal,
        }),
    });

    expect(startup).toEqual({
      exit: { code: 3, signal: null },
      kind: "process-exited",
    });
    const probesAtExit = probes;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    expect(probes).toBeLessThanOrEqual(probesAtExit + 1);
    expect(onSlowStart).not.toHaveBeenCalled();
  });

  it("has no deadline while the process is alive", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetchImpl: ServerProbeFetch = () =>
      Promise.reject(new TypeError("fetch failed"));
    let settled = false;

    const startup = waitForOwnedRuntimeStartup({
      exit: new Promise(() => {}),
      onSlowStart: () => {},
      slowStartNoticeMs: 10_000,
      waitForServer: (signal) =>
        waitForCompatibleServer({
          fetchImpl,
          intervalMs: 250,
          serverUrl: "http://127.0.0.1:1",
          signal,
        }),
    }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(settled).toBe(false);
    void startup;
  });
});
