import { Worker } from "node:worker_threads";
import { createDeferredPromise } from "@bb/test-helpers";
import { getTerminalSession } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTestDaemonHostKey } from "../helpers/test-app.js";
import {
  startTerminalTestFixture,
  type TerminalTestFixture,
} from "../helpers/relay-test-server.js";

const driverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attached") }),
  z.object({ type: z.literal("error"), error: z.string() }),
  z.object({
    type: z.literal("result"),
    latency: z.array(z.number()),
    starts: z.array(z.number()),
    lastSeq: z.number(),
  }),
]);
let fixture: TerminalTestFixture | null = null;
let worker: Worker | null = null;
afterEach(async () => {
  await worker?.terminate();
  worker = null;
  await fixture?.close();
  fixture = null;
});

async function measureStalledEcho(relayOn: boolean) {
  fixture = await startTerminalTestFixture(relayOn);
  const { server, terminal } = fixture;
  const url = new URL(
    `/ws/terminals/${terminal.id}?sinceSeq=0&outputAcks=1`,
    server.baseUrl,
  );
  url.protocol = "ws:";
  const attached = createDeferredPromise<void>();
  const finished = createDeferredPromise<{
    latency: number[];
    starts: number[];
    lastSeq: number;
  }>();
  worker = new Worker(
    new URL("../helpers/terminal-input-driver.mjs", import.meta.url),
    {
      workerData: {
        url: url.href,
        origin: server.config.appUrl,
        count: 100,
        intervalMs: 20,
      },
    },
  );
  worker.on("message", (raw: unknown) => {
    const message = driverMessageSchema.parse(raw);
    if (message.type === "attached") attached.resolve(undefined);
    else if (message.type === "result") finished.resolve(message);
    else finished.reject(new Error(message.error));
  });
  worker.on("error", finished.reject);
  await attached.promise;
  const key = createTestDaemonHostKey({ hostId: terminal.hostId });
  const stall = async () => {
    const started = performance.now();
    const response = await fetch(
      new URL("/internal/test/stall?ms=1000", server.baseUrl),
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
      },
    );
    const ended = performance.now();
    expect(response.status).toBe(200);
    return { duration: ended - started, ended, started };
  };
  const stall1 = await stall();
  const stall2 = await stall();
  const result = await finished.promise;
  await vi.waitFor(() => {
    const row = getTerminalSession(server.db, {
      kind: "terminal",
      terminalId: terminal.id,
    });
    expect(row?.lastUserInputAt).not.toBeNull();
  });
  return { ...result, stalls: [stall1, stall2] };
}

describe("terminal relay during main-loop stalls", () => {
  it("echoes every input while main is blocked and eventually records input", async () => {
    const result = await measureStalledEcho(true);
    expect(result.stalls.every((stall) => stall.duration >= 1000)).toBe(true);
    for (const stall of result.stalls)
      expect(
        result.starts.filter(
          (started) => started >= stall.started && started <= stall.ended,
        ).length,
      ).toBeGreaterThanOrEqual(10);
    expect(result.latency).toHaveLength(100);
    expect(
      result.latency[Math.floor(result.latency.length * 0.99)],
    ).toBeLessThan(50);
  }, 30_000);

  it("detects the same stalls without the relay", async () => {
    const result = await measureStalledEcho(false);
    expect(result.stalls.every((stall) => stall.duration >= 1000)).toBe(true);
    for (const stall of result.stalls)
      expect(
        result.starts.filter(
          (started) => started >= stall.started && started <= stall.ended,
        ).length,
      ).toBeGreaterThanOrEqual(10);
    expect(result.latency).toHaveLength(100);
    expect(
      result.latency[Math.floor(result.latency.length * 0.99)],
    ).toBeGreaterThan(500);
  }, 30_000);

  it("requires daemon authentication for the test-only stall route", async () => {
    fixture = await startTerminalTestFixture(true);
    const response = await fetch(
      new URL("/internal/test/stall?ms=1000", fixture.server.baseUrl),
      { method: "POST" },
    );
    expect(response.status).toBe(401);
  }, 20_000);
});
