import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppUpdateTelemetry } from "../../src/services/system/app-update-telemetry.js";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { testLogger } from "../helpers/test-app.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(args: {
  currentRevision?: string;
  enabled?: boolean;
  now?: () => number;
}) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-app-update-telemetry-"));
  roots.push(dataDir);
  const capture = vi.fn<TelemetryService["capture"]>();
  const flush = vi.fn<TelemetryService["flush"]>(async () => undefined);
  const telemetry: TelemetryService = {
    capture,
    flush,
    isEnabled: () => true,
    setEnabled: () => undefined,
  };
  const create = (currentRevision: string) =>
    createAppUpdateTelemetry({
      currentRevision,
      dataDir,
      enabled: () => args.enabled ?? true,
      logger: testLogger,
      ...(args.now === undefined ? {} : { now: args.now }),
      telemetry,
    });
  return {
    capture,
    create,
    dataDir,
    flush,
    updates: create(args.currentRevision ?? "1.0.0"),
  };
}

describe("app update telemetry", () => {
  it("caps counts and sends the started event", async () => {
    const { capture, updates } = await fixture({});
    updates.started({ entry: "cli", mode: "prepare", runningThreads: 80 });
    expect(capture).toHaveBeenCalledWith({
      name: "app_update_started",
      properties: { running_threads: 50, mode: "prepare", entry: "cli" },
    });
  });

  it("sends one settled event per thread and a flushed restart summary", async () => {
    const { capture, flush, updates } = await fixture({});
    await updates.restarting({
      reason: "cap_reached",
      targetRevision: "1.1.0",
      threads: [
        { providerId: "codex", saveResult: "saved", stopMethod: "terminate" },
        {
          providerId: "unknown-agent",
          saveResult: "forced",
          stopMethod: "plain_steer_fallback",
        },
      ],
      waitMs: 30_400,
    });
    expect(capture.mock.calls.map(([event]) => event)).toEqual([
      {
        name: "app_update_thread_settled",
        properties: {
          provider: "codex",
          save_result: "saved",
          stop_method: "terminate",
        },
      },
      {
        name: "app_update_thread_settled",
        properties: {
          provider: "other",
          save_result: "forced",
          stop_method: "plain_steer_fallback",
        },
      },
      {
        name: "app_update_restart_started",
        properties: {
          threads_stopped: 2,
          threads_saved: 1,
          threads_forced: 1,
          wait_seconds: 30,
          reason: "cap_reached",
        },
      },
    ]);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reports the finished update once on the next boot", async () => {
    let clock = 1_000_000;
    const { capture, create, updates } = await fixture({ now: () => clock });
    await updates.restarting({
      reason: "nothing_running",
      targetRevision: "1.1.0",
      threads: [],
      waitMs: 0,
    });
    capture.mockClear();

    clock += 42_400;
    const restarted = create("1.1.0");
    await restarted.reportFinished({ threadsResumed: 3 });
    await restarted.reportFinished({ threadsResumed: 3 });
    expect(capture.mock.calls.map(([event]) => event)).toEqual([
      {
        name: "app_update_finished",
        properties: {
          threads_resumed: 3,
          offline_seconds: 42,
          outcome: "succeeded",
        },
      },
    ]);
  });

  it("reports a failed update when bb comes back on another revision", async () => {
    const { capture, create, updates } = await fixture({});
    await updates.restarting({
      reason: "update_now",
      targetRevision: "1.1.0",
      threads: [],
      waitMs: 0,
    });
    await create("1.0.0").reportFinished({ threadsResumed: 0 });
    expect(capture).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "app_update_finished",
        properties: expect.objectContaining({ outcome: "failed" }),
      }),
    );
  });

  it("sends nothing while the flag is off but still clears the marker", async () => {
    const { capture, create, dataDir, updates } = await fixture({
      enabled: false,
    });
    updates.started({ entry: "settings", mode: "now", runningThreads: 1 });
    await updates.restarting({
      reason: "update_now",
      targetRevision: "1.1.0",
      threads: [
        { providerId: "codex", saveResult: "forced", stopMethod: "none" },
      ],
      waitMs: 0,
    });
    await create("1.1.0").reportFinished({ threadsResumed: 1 });
    expect(capture).not.toHaveBeenCalled();
    await expect(
      access(join(dataDir, "bb-app-update-restart.json")),
    ).rejects.toThrow();
  });

  it("ignores an unreadable marker", async () => {
    const { capture, dataDir, updates } = await fixture({});
    await writeFile(join(dataDir, "bb-app-update-restart.json"), "{not json");
    await updates.reportFinished({ threadsResumed: 0 });
    expect(capture).not.toHaveBeenCalled();
  });
});
