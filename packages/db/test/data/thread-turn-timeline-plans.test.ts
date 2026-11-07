import { expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import {
  deleteThreadEventSuffixInTransaction,
  insertEvents,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  listThreadTurnTimelinePlanRecords,
  upsertThreadTurnTimelinePlanRecord,
} from "../../src/data/thread-turn-timeline-plans.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

it("drops a thread's stored turn plans when its history suffix is rewritten", () => {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "plan-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "plan-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/plans" },
  });
  const threadId = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  }).id;
  insertEvents(
    db,
    noopNotifier,
    [1, 2, 3].map((sequence) => ({
      threadId,
      sequence,
      type: "turn/started" as const,
      scope: turnScope(`turn-${sequence}`),
      providerThreadId: "provider",
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: "{}",
    })),
  );
  upsertThreadTurnTimelinePlanRecord(db, {
    planJson: "{}",
    projectionKey: "key",
    threadId,
    turnId: "turn-1",
    watermark: 1,
  });
  const listPlans = () =>
    listThreadTurnTimelinePlanRecords(db, { threadId, turnIds: ["turn-1"] });
  expect(listPlans()).toHaveLength(1);

  db.transaction((tx) =>
    deleteThreadEventSuffixInTransaction(tx, {
      cutoffSequence: 2,
      oldMaxSequence: 3,
      threadId,
    }),
  );

  expect(listPlans()).toEqual([]);
});
