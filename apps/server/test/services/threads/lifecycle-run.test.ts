import { getThread, markThreadDeleted, readThreadRunState } from "@bb/db";
import { describe, expect, it } from "vitest";
import { runThreadLifecycleTransaction } from "../../../src/services/threads/lifecycle/run.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const newTurn = {
  type: "request.sent" as const,
  request: {
    hostId: "host-run",
    kind: "new-turn" as const,
    requestId: "creq_run_1",
    syncTitle: false,
  },
  now: 1,
};

describe("runThreadLifecycleTransaction", () => {
  it("reports a missing thread and writes nothing", async () => {
    await withTestHarness(async (harness) => {
      const outcome = runThreadLifecycleTransaction(
        harness.deps,
        "thr_missing",
        newTurn,
      );
      expect(outcome).toMatchObject({
        refusal: "not-found",
        statusChanged: false,
        thread: null,
      });
      expect(readThreadRunState(harness.db, "thr_missing")).toEqual({
        heldCompletion: null,
        requests: [],
        stop: null,
      });
    });
  });

  it("leaves the row and its run state untouched when the machine refuses the input", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-run" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "stopping",
      });
      const before = getThread(harness.db, thread.id);

      const outcome = runThreadLifecycleTransaction(
        harness.deps,
        thread.id,
        newTurn,
      );

      expect(outcome.refusal).toBe("stopping");
      expect(getThread(harness.db, thread.id)).toEqual(before);
      expect(readThreadRunState(harness.db, thread.id).requests).toEqual([]);
    });
  });

  it("refuses to start a run on a deleted thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-run" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "idle",
      });
      markThreadDeleted(harness.db, harness.hub, { threadId: thread.id });
      const before = getThread(harness.db, thread.id);

      expect(
        runThreadLifecycleTransaction(harness.deps, thread.id, newTurn).refusal,
      ).toBe("deleted");
      expect(getThread(harness.db, thread.id)).toEqual(before);
    });
  });
});
