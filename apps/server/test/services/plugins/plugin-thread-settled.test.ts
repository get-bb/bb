import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadSettledEvent } from "@get-bb/plugin-sdk";
import { moveThreadStatus } from "../../helpers/thread-status.js";
import { textInput } from "../../helpers/prompt-input.js";
import { seedQueuedMessage, seedThreadFixture } from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

interface Recorded {
  outcome: PluginThreadSettledEvent["outcome"];
  threadId: string;
  entryId: string | null;
}

const globals = globalThis as Record<string, unknown>;

async function installRecorder(harness: TestAppHarness, workDir: string) {
  const rootDir = join(workDir, "bb-plugin-settled-recorder");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-settled-recorder",
      version: "0.1.0",
      bb: {
        name: "Settled recorder",
        description: "Records thread outcomes.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `
      export default function plugin(bb: any) {
        bb.events.on("experimental_thread.settled", (event: any) => {
          (globalThis as any).__settled.push({
            outcome: event.outcome,
            threadId: event.thread.id,
            entryId: event.outcome === "cancelled" ? event.entry.id : null,
          });
        });
      }
    `,
  );
  const entry = await harness.pluginService.installPath(rootDir);
  expect(entry.status).toBe("running");
}

function lifecycleDeps(harness: TestAppHarness) {
  return {
    db: harness.db,
    hub: harness.hub,
    providerRegistry: harness.deps.providerRegistry,
  };
}

const OUTCOME_TRIGGERS: Record<
  PluginThreadSettledEvent["outcome"],
  (
    harness: TestAppHarness,
  ) => Promise<{ threadId: string; entryId: string | null }>
> = {
  async completed(harness) {
    const { thread } = seedThreadFixture(harness, {
      thread: { status: "active" },
    });
    expect(
      moveThreadStatus(lifecycleDeps(harness), {
        move: "run.succeeded",
        threadId: thread.id,
      }).applied,
    ).toBe(true);
    return { threadId: thread.id, entryId: null };
  },
  async failed(harness) {
    const { thread } = seedThreadFixture(harness, {
      thread: { status: "active" },
    });
    expect(
      moveThreadStatus(lifecycleDeps(harness), {
        move: "run.failed",
        threadId: thread.id,
      }).applied,
    ).toBe(true);
    return { threadId: thread.id, entryId: null };
  },
  async cancelled(harness) {
    const { thread } = seedThreadFixture(harness, {
      thread: { status: "idle" },
    });
    const queued = seedQueuedMessage(harness.deps, {
      threadId: thread.id,
      content: textInput("Later"),
      waitingOn: {
        kind: "plugin",
        pluginId: "settled-recorder",
        reason: "Holding for the test",
      },
    });
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/queued-messages/${queued.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);
    return { threadId: thread.id, entryId: queued.id };
  },
  async archived(harness) {
    const { thread } = seedThreadFixture(harness, {
      thread: { status: "idle" },
    });
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/archive-all`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    return { threadId: thread.id, entryId: null };
  },
  async deleted(harness) {
    const { thread } = seedThreadFixture(harness, {
      thread: { status: "idle" },
    });
    const response = await harness.app.request(`/api/v1/threads/${thread.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ childThreadsConfirmed: true }),
    });
    expect(response.status).toBe(200);
    return { threadId: thread.id, entryId: null };
  },
};

describe("experimental_thread.settled", () => {
  afterEach(() => {
    delete globals.__settled;
  });

  it.each(Object.entries(OUTCOME_TRIGGERS))(
    "reports a thread that ends as %s through core's own path",
    async (outcome, trigger) => {
      const recorded: Recorded[] = [];
      globals.__settled = recorded;
      const harness = await createTestAppHarness();
      const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-settled-"));
      try {
        await installRecorder(harness, workDir);
        const { threadId, entryId } = await trigger(harness);
        await vi.waitFor(() =>
          expect(recorded).toEqual([{ outcome, threadId, entryId }]),
        );
      } finally {
        await harness.pluginService.stop();
        await rm(workDir, { recursive: true, force: true });
        await harness.cleanup();
      }
    },
  );
});
