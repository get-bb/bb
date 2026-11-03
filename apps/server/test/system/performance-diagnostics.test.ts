import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { inspect } from "node:util";
import { setExperiments } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { startGatedPerformanceDiagnostics } from "../../src/services/system/performance-diagnostics.js";

type DiagnosticLog = {
  level: "info" | "warn";
  elapsedMs: number;
  fields: unknown;
  message: string;
};

async function until(
  logs: readonly DiagnosticLog[],
  message: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (
    !logs.some((entry) => entry.message === message) &&
    Date.now() < deadline
  ) {
    if (logs.some((entry) => entry.level === "warn"))
      throw new Error(
        `Profiler warning while waiting for ${message}:\n${inspect(logs, { depth: 5 })}`,
      );
    await setTimeout(10);
  }
  expect(
    logs.map((entry) => entry.message),
    inspect(logs, { depth: 5 }),
  ).toContain(message);
}

describe("performance diagnostics gates", () => {
  it.each([false, true])(
    "requires launch permission %s as well as the live experiment",
    async (allowed) => {
      const db = createMigratedConnection();
      const dataDir = await mkdtemp(join(tmpdir(), "bb-perf-gates-"));
      const hub = new NotificationHub();
      const messages: DiagnosticLog[] = [];
      const startedAt = performance.now();
      const record = (
        level: DiagnosticLog["level"],
        fields: unknown,
        message = "",
      ) => {
        messages.push({
          level,
          elapsedMs: performance.now() - startedAt,
          fields,
          message,
        });
      };
      const monitor = await startGatedPerformanceDiagnostics({
        allowed,
        dataDir,
        db,
        hub,
        logger: {
          info: (fields: unknown, message?: string) =>
            record("info", fields, message),
          warn: (fields: unknown, message?: string) =>
            record("warn", fields, message),
        },
      });
      try {
        expect(monitor.isEnabled()).toBe(false);
        expect(await readdir(dataDir)).toEqual([]);
        setExperiments(db, { performanceDiagnostics: true });
        hub.notifySystem(["config-changed"]);
        expect(monitor.isEnabled()).toBe(allowed);
        if (allowed) {
          await until(messages, "Server performance diagnostics enabled");
        } else {
          await setTimeout(30);
          expect(messages).toEqual([]);
          expect(await readdir(dataDir)).toEqual([]);
        }
        setExperiments(db, { performanceDiagnostics: false });
        hub.notifySystem(["config-changed"]);
        expect(monitor.isEnabled()).toBe(false);
        if (allowed) {
          await until(messages, "Server performance diagnostics stopped");
          const captures = await readdir(join(dataDir, "logs", "performance"));
          expect(captures).toHaveLength(1);
          expect(captures[0]).toMatch(/\.cpuprofile$/);
        }
        setExperiments(db, { performanceDiagnostics: true });
        hub.notifySystem(["config-changed"]);
        await monitor.stop();
        expect(monitor.isEnabled()).toBe(false);
        hub.notifySystem(["config-changed"]);
        expect(monitor.isEnabled()).toBe(false);
        const restarted = await startGatedPerformanceDiagnostics({
          allowed,
          dataDir,
          db,
          hub,
          logger: { info: () => {}, warn: () => {} },
        });
        try {
          expect(restarted.isEnabled()).toBe(allowed);
        } finally {
          await restarted.stop();
        }
      } finally {
        await monitor.stop();
        db.$client.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});
