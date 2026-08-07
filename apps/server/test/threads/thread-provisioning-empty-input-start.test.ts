import { getThread, listEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { listProjectPromptHistory } from "../../src/services/prompt-history.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForStatus(
  harness: { db: Parameters<typeof getThread>[0] },
  threadId: string,
  status: string,
): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (getThread(harness.db, threadId)?.status === status) return;
    await sleep(10);
  }
  throw new Error(
    `thread ${threadId} did not reach ${status}; last=${getThread(harness.db, threadId)?.status}`,
  );
}

describe("non-fork empty-input start provisions idle without a turn", () => {
  it("settles idle with no turn anchor and dispatches no thread.start", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-room-primary",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/room-primary-project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/room-primary-project",
        status: "ready",
      });

      const thread = await createThreadFromRequest(harness.deps, {
        childOrigin: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: "/tmp/room-primary-project" },
        },
        // The Work Together room primary thread is created with no first turn.
        input: [],
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      // Settles idle via the seed-without-run lazy-idle branch (no provider run).
      await waitForStatus(harness, thread.id, "idle");

      const events = listEvents(harness.db, { threadId: thread.id });
      const types = events.map((event) => event.type);

      // No phantom user turn: the empty-input anchor turn is not persisted.
      expect(types).not.toContain("client/turn/requested");
      // The lifecycle start marker is still recorded (principal attribution).
      expect(types).toContain("client/thread/start");
      // No provider run event was ever emitted.
      expect(types).not.toContain("turn/started");

      // No malformed (min(1)-violating) project prompt-history row was written.
      const history = listProjectPromptHistory(harness.deps, {
        projectId: project.id,
      });
      expect(history).toHaveLength(0);
    });
  });
});
