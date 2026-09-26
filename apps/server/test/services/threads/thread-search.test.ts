import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveThread,
  createConnection,
  createThread,
  ensurePersonalProject,
  migrate,
  noopNotifier,
  searchThreadsWithPendingInteractionState,
  updateThread,
} from "@bb/db";
import { expect, it } from "vitest";
import {
  closeThreadSearch,
  searchThreads,
} from "../../../src/services/threads/thread-search.js";

it("searches persisted data without blocking timers and skips cancelled queued searches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-thread-search-"));
  const db = createConnection(join(dir, "bb.db"));
  try {
    migrate(db);
    ensurePersonalProject(db);
    const thread = createThread(db, noopNotifier, {
      projectId: "proj_personal",
      providerId: "codex",
      title: "Search worker needle",
    });
    const archived = createThread(db, noopNotifier, {
      projectId: "proj_personal",
      providerId: "codex",
      title: "Archived needle",
    });
    archiveThread(db, noopNotifier, archived.id);
    const args = { query: "needle", limitPerGroup: 20 };
    const expected = searchThreadsWithPendingInteractionState(db, args);
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
    }, 0);
    const first = searchThreads(db, args, new AbortController().signal);
    const cancellation = new AbortController();
    const queued = searchThreads(db, args, cancellation.signal);
    const cancelled = expect(queued).rejects.toMatchObject({
      name: "AbortError",
    });
    cancellation.abort();
    expect(await first).toEqual(expected);
    clearTimeout(timer);
    expect(timerFired).toBe(true);
    await cancelled;
    updateThread(db, noopNotifier, thread.id, { title: "Renamed thread" });
    const updated = await searchThreads(db, args, new AbortController().signal);
    expect(updated.active.total).toBe(0);
    expect(updated.archived.results.map((result) => result.thread.id)).toEqual([
      archived.id,
    ]);
  } finally {
    await closeThreadSearch(db);
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
