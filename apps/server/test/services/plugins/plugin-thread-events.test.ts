import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments, threadScope, turnScope } from "@bb/domain";
import { applyLoggedThreadLifecycleEvent } from "../../../src/services/threads/lifecycle-outcome.js";
import { createThreadRecord } from "../../../src/services/threads/thread-create-helpers.js";
import type { ThreadCreateServiceRequest } from "../../../src/services/threads/thread-create-request.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  createTestAppHarness,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

interface RecordedThreadPayload {
  thread: { id: string; status: string };
  lastAssistantText?: string | null;
  error?: string | null;
}

const globals = globalThis as Record<string, unknown>;

/**
 * Full-app harness (createApp registers the lifecycle→plugin bridge) with one
 * path plugin installed and running. Events land through the REAL seams:
 * applyLoggedThreadLifecycleEvent and createThreadRecord.
 */
async function setUpPluginHarness(serverSource: string): Promise<{
  harness: TestAppHarness;
  cleanup(): Promise<void>;
}> {
  const harness = await createTestAppHarness();
  setExperiments(harness.db, { ...defaultExperiments, plugins: true });
  const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-events-"));
  const rootDir = join(workDir, "bb-plugin-observer");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-observer",
      version: "0.1.0",
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), serverSource);
  const entry = await harness.pluginService.installPath(rootDir);
  expect(entry.status).toBe("running");
  return {
    harness,
    async cleanup() {
      await harness.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await harness.cleanup();
    },
  };
}

function lifecycleDeps(harness: TestAppHarness) {
  return { db: harness.db, hub: harness.hub, logger: testLogger };
}

describe("plugin thread lifecycle events", () => {
  it("delivers thread.idle with the public DTO and lastAssistantText", async () => {
    const recorded: RecordedThreadPayload[] = [];
    globals.__idleEvents = recorded;
    const { harness, cleanup } = await setUpPluginHarness(`
      export default function plugin(bb: any) {
        bb.on("thread.idle", (payload: any) => {
          (globalThis as any).__idleEvents.push(payload);
        });
      }
    `);
    try {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: "assistant-1", text: "All done." },
        },
      });

      const outcome = applyLoggedThreadLifecycleEvent(lifecycleDeps(harness), {
        threadId: thread.id,
        event: { type: "run.succeeded" },
      });
      expect(outcome.applied).toBe(true);

      await vi.waitFor(() => expect(recorded).toHaveLength(1));
      expect(recorded[0]?.thread.id).toBe(thread.id);
      expect(recorded[0]?.thread.status).toBe("idle");
      expect(recorded[0]?.lastAssistantText).toBe("All done.");

      const entry = harness.pluginService
        .list()
        .find((plugin) => plugin.id === "observer");
      expect(entry?.handlerStats.count).toBe(1);
      expect(entry?.handlerStats.errorCount).toBe(0);
    } finally {
      delete globals.__idleEvents;
      await cleanup();
    }
  });

  it("delivers thread.failed with the latest system/error message", async () => {
    const recorded: RecordedThreadPayload[] = [];
    globals.__failedEvents = recorded;
    const { harness, cleanup } = await setUpPluginHarness(`
      export default function plugin(bb: any) {
        bb.on("thread.failed", (payload: any) => {
          (globalThis as any).__failedEvents.push(payload);
        });
      }
    `);
    try {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        scope: threadScope(),
        sequence: 1,
        type: "system/error",
        data: { code: "provider_process_exited", message: "provider exploded" },
      });

      const outcome = applyLoggedThreadLifecycleEvent(lifecycleDeps(harness), {
        threadId: thread.id,
        event: { type: "run.failed" },
      });
      expect(outcome.applied).toBe(true);

      await vi.waitFor(() => expect(recorded).toHaveLength(1));
      expect(recorded[0]?.thread.id).toBe(thread.id);
      expect(recorded[0]?.thread.status).toBe("error");
      expect(recorded[0]?.error).toBe("provider exploded");
    } finally {
      delete globals.__failedEvents;
      await cleanup();
    }
  });

  it("delivers thread.created from the thread creation seam", async () => {
    const recorded: RecordedThreadPayload[] = [];
    globals.__createdEvents = recorded;
    const { harness, cleanup } = await setUpPluginHarness(`
      export default function plugin(bb: any) {
        bb.on("thread.created", (payload: any) => {
          (globalThis as any).__createdEvents.push(payload);
        });
      }
    `);
    try {
      const { environment, project } = seedThreadFixture(harness);
      const request: ThreadCreateServiceRequest = {
        environment: { type: "reuse", environmentId: environment.id },
        input: [],
        origin: null,
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
        titleFallback: "Plugin event test thread",
      };
      const thread = createThreadRecord(
        { db: harness.db, hub: harness.hub },
        { environmentId: environment.id, request },
      );

      await vi.waitFor(() => expect(recorded).toHaveLength(1));
      expect(recorded[0]?.thread.id).toBe(thread.id);
      expect(recorded[0]?.thread.status).toBe("starting");
    } finally {
      delete globals.__createdEvents;
      await cleanup();
    }
  });

  it("isolates a throwing handler, keeps the transition, and records metrics", async () => {
    const recorded: RecordedThreadPayload[] = [];
    globals.__survivorEvents = recorded;
    const { harness, cleanup } = await setUpPluginHarness(`
      export default function plugin(bb: any) {
        bb.on("thread.idle", () => {
          throw new Error("handler boom");
        });
        bb.on("thread.idle", (payload: any) => {
          (globalThis as any).__survivorEvents.push(payload);
        });
      }
    `);
    try {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });

      const outcome = applyLoggedThreadLifecycleEvent(lifecycleDeps(harness), {
        threadId: thread.id,
        event: { type: "run.succeeded" },
      });
      // The plugin handler exploding must not disturb the transition.
      expect(outcome.applied).toBe(true);

      await vi.waitFor(() => expect(recorded).toHaveLength(1));
      expect(recorded[0]?.lastAssistantText).toBeNull();

      await vi.waitFor(() => {
        const entry = harness.pluginService
          .list()
          .find((plugin) => plugin.id === "observer");
        expect(entry?.handlerStats.count).toBe(2);
        expect(entry?.handlerStats.errorCount).toBe(1);
        expect(entry?.handlerStats.maxMs).toBeGreaterThanOrEqual(0);
        expect(entry?.status).toBe("running");
        expect(entry?.statusDetail).toContain("thread.idle handler failed");
      });

      // The stats travel through GET /api/v1/plugins for bb plugin list.
      const response = await harness.app.request("/api/v1/plugins");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        plugins: Array<{ id: string; handlerStats: { count: number } }>;
      };
      expect(
        body.plugins.find((plugin) => plugin.id === "observer")?.handlerStats
          .count,
      ).toBe(2);
    } finally {
      delete globals.__survivorEvents;
      await cleanup();
    }
  });

  it("stops delivering to a disabled plugin", async () => {
    const recorded: RecordedThreadPayload[] = [];
    globals.__disabledEvents = recorded;
    const { harness, cleanup } = await setUpPluginHarness(`
      export default function plugin(bb: any) {
        bb.on("thread.idle", (payload: any) => {
          (globalThis as any).__disabledEvents.push(payload);
        });
      }
    `);
    try {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      applyLoggedThreadLifecycleEvent(lifecycleDeps(harness), {
        threadId: thread.id,
        event: { type: "run.succeeded" },
      });
      await vi.waitFor(() => expect(recorded).toHaveLength(1));

      await harness.pluginService.setEnabled("observer", false);
      applyLoggedThreadLifecycleEvent(lifecycleDeps(harness), {
        threadId: thread.id,
        event: { type: "run.started" },
      });
      applyLoggedThreadLifecycleEvent(lifecycleDeps(harness), {
        threadId: thread.id,
        event: { type: "run.succeeded" },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(recorded).toHaveLength(1);
    } finally {
      delete globals.__disabledEvents;
      await cleanup();
    }
  });
});
