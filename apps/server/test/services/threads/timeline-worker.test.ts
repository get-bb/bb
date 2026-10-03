import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  getLatestThreadSequence,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { threadScope } from "@bb/domain";
import {
  buildThreadTimelineWithProfile,
  type BuildThreadTimelineOptions,
} from "../../../src/services/threads/timeline.js";
import { createTimelineWorkerClient } from "../../../src/services/threads/timeline-worker-client.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run();
});

it("builds identical history off the main thread and sees subsequent database writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bb-timeline-worker-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "timeline.db");
  const db = createConnection(databasePath);
  migrate(db);
  cleanup.push(async () => db.$client.close());
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test",
    source: { type: "local_path", hostId: host.id, path: directory },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const makeEvent = (sequence: number) => ({
    threadId: thread.id,
    scope: threadScope(),
    sequence,
    type: "system/error" as const,
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    data: JSON.stringify({ message: `History ${sequence}` }),
  });
  insertEvents(
    db,
    noopNotifier,
    Array.from({ length: 4000 }, (_, index) => makeEvent(index + 1)),
  );
  const options: BuildThreadTimelineOptions = {
    completedTurnDisplay: "collapse",
    eventBudget: 100000,
    includeDiagnosticOperations: false,
    maxInlineOutputChars: 1000,
    maxSeq: getLatestThreadSequence(db, { threadId: thread.id }),
    page: { kind: "latest", segmentLimit: 20 },
  };
  const expected = buildThreadTimelineWithProfile(db, thread, options).response;
  const client = createTimelineWorkerClient(
    databasePath,
    new URL("../../../dist/timeline-worker.js", import.meta.url),
  );
  cleanup.push(() => client.dispose());
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    expect((await client.build(thread, options)).response).toEqual(expected);
    expect(ticks).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
  }
  insertEvents(db, noopNotifier, [makeEvent(4001)]);
  const latest = { ...options, maxSeq: 4001 };
  expect((await client.build(thread, latest)).response).toEqual(
    buildThreadTimelineWithProfile(db, thread, latest).response,
  );
});
