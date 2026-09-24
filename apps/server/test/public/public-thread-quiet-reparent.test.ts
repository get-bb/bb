// bb-fork(quiet-reparent): fork-owned coverage for the quiet reparent switch
import { and, eq } from "drizzle-orm";
import { events, getThread } from "@bb/db";
import {
  systemOperationEventDataSchema,
  threadSchema,
  turnRequestEventDataSchema,
  type SystemMessageKind,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

interface QuietReparentFixture {
  childThreadId: string;
  parentThreadId: string;
  projectId: string;
}

function seedLiveParentWithChild(
  harness: TestHarness,
  suffix: string,
): QuietReparentFixture {
  const { host } = seedHostSession(harness.deps, { id: `host-${suffix}` });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/${suffix}-environment`,
  });
  const parent = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    title: "Manager",
  });
  seedThreadRuntimeState(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: `provider-${suffix}`,
    inputText: "Manage things",
    model: "fake-model",
  });
  const child = seedThread(harness.deps, {
    projectId: project.id,
    title: "Worker child",
    parentThreadId: parent.id,
  });
  return {
    childThreadId: child.id,
    parentThreadId: parent.id,
    projectId: project.id,
  };
}

function listSystemTurnRequestKinds(
  harness: TestHarness,
  parentThreadId: string,
): SystemMessageKind[] {
  const rows = harness.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.threadId, parentThreadId),
        eq(events.type, "client/turn/requested"),
      ),
    )
    .orderBy(events.sequence)
    .all();
  const kinds: SystemMessageKind[] = [];
  for (const row of rows) {
    const data = turnRequestEventDataSchema.parse(JSON.parse(row.data));
    if (data.initiator === "system") {
      kinds.push(data.systemMessageKind ?? "unlabeled");
    }
  }
  return kinds;
}

async function waitForSystemTurnRequest(
  harness: TestHarness,
  parentThreadId: string,
  timeoutMs = 4_000,
): Promise<SystemMessageKind[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const kinds = listSystemTurnRequestKinds(harness, parentThreadId);
    if (kinds.length > 0) {
      return kinds;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for a parent system turn request");
}

async function collectSystemTurnRequestsFor(
  harness: TestHarness,
  parentThreadId: string,
  windowMs: number,
): Promise<SystemMessageKind[]> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return listSystemTurnRequestKinds(harness, parentThreadId);
}

describe("public thread quiet reparent", () => {
  it("notifies the former parent on a default detach", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLiveParentWithChild(harness, "quiet-control");

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.childThreadId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentThreadId: null }),
        },
      );

      expect(response.status).toBe(200);
      const kinds = await waitForSystemTurnRequest(
        harness,
        fixture.parentThreadId,
      );
      expect(kinds).toContain("ownership-removed");
    });
  });

  it("stays silent on the parents with ownershipNotice false", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLiveParentWithChild(harness, "quiet-detach");

      const response = await harness.app.request(
        `/api/v1/threads/${fixture.childThreadId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            parentThreadId: null,
            ownershipNotice: false,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(threadSchema.parse(await readJson(response))).toMatchObject({
        parentThreadId: null,
      });
      expect(getThread(harness.db, fixture.childThreadId)).toMatchObject({
        parentThreadId: null,
      });

      const kinds = await collectSystemTurnRequestsFor(
        harness,
        fixture.parentThreadId,
        750,
      );
      expect(kinds).toEqual([]);

      const childOperations = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, fixture.childThreadId),
            eq(events.type, "system/operation"),
          ),
        )
        .all()
        .map((row) => systemOperationEventDataSchema.parse(JSON.parse(row.data)));
      expect(
        childOperations.some(
          (operation) => operation.operation === "ownership_change",
        ),
      ).toBe(true);
    });
  });
});
