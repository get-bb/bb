import {
  archiveThread,
  createThreadHandoff as createThreadHandoffRow,
  getThread,
  getThreadHandoffByReplacementThreadId,
} from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import {
  settleThreadHandoffFailed,
  settleThreadHandoffStarted,
} from "../../src/services/threads/thread-handoff.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedHandoff(
  harness: TestAppHarness,
  args: { archiveSource: boolean },
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const source = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const replacement = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "starting",
  });
  createThreadHandoffRow(harness.db, {
    archiveSource: args.archiveSource,
    environmentId: environment.id,
    idempotencyKey: `handoff-${replacement.id}`,
    model: "gpt-5.6-codex",
    permissionMode: "accept-edits",
    projectId: project.id,
    providerId: "codex",
    reasoningLevel: "high",
    replacementThreadId: replacement.id,
    serviceTier: null,
    sourceThreadId: source.id,
  });
  return { replacement, source };
}

describe("thread handoff lifecycle settlement", () => {
  it("keeps the source live until the replacement root turn is accepted as started", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });

      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({ status: "provisioning" });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });

  it("atomically starts the handoff and archives its source, then runs archive side effects", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );
      const notifyThread = vi.spyOn(harness.deps.hub, "notifyThread");

      const outcome = settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(outcome).toMatchObject({ applied: true });
      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({ status: "started", failureCode: null });
      expect(getThread(harness.db, source.id)?.archivedAt).toEqual(
        expect.any(Number),
      );
      expect(closeTerminals).toHaveBeenCalledWith({ threadId: source.id });
      expect(notifyThread).toHaveBeenCalledWith(
        source.id,
        ["archived-changed"],
        expect.objectContaining({ projectId: source.projectId }),
      );
    });
  });

  it("releases assigned children when takeover archives their source", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const child = seedThread(harness.deps, {
        environmentId: source.environmentId,
        parentThreadId: source.id,
        projectId: source.projectId,
      });

      settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(getThread(harness.db, source.id)?.archivedAt).toEqual(
        expect.any(Number),
      );
      expect(getThread(harness.db, child.id)?.parentThreadId).toBeNull();
    });
  });

  it("marks archiveSource=false started without archiving the source", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: false,
      });

      expect(
        settleThreadHandoffStarted(harness.deps, replacement.id),
      ).toMatchObject({ applied: true });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });

  it("treats a manually archived source as satisfying a started handoff", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      archiveThread(harness.db, harness.hub, source.id);
      const archivedAt = getThread(harness.db, source.id)?.archivedAt;
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );

      expect(
        settleThreadHandoffStarted(harness.deps, replacement.id),
      ).toMatchObject({ applied: true });
      expect(getThread(harness.db, source.id)?.archivedAt).toBe(archivedAt);
      expect(closeTerminals).not.toHaveBeenCalled();
    });
  });

  it("is idempotent after the first started settlement", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });
      const closeTerminals = vi.spyOn(
        harness.deps.terminalSessions,
        "closeArchivedThreadTerminals",
      );

      settleThreadHandoffStarted(harness.deps, replacement.id);
      const archivedAt = getThread(harness.db, source.id)?.archivedAt;
      const repeated = settleThreadHandoffStarted(harness.deps, replacement.id);

      expect(repeated).toMatchObject({
        applied: false,
        reason: "already-settled",
        handoff: { status: "started" },
      });
      expect(getThread(harness.db, source.id)?.archivedAt).toBe(archivedAt);
      expect(closeTerminals).toHaveBeenCalledTimes(1);
    });
  });

  it("records a structured terminal failure and leaves the source live", async () => {
    await withTestHarness(async (harness) => {
      const { replacement, source } = seedHandoff(harness, {
        archiveSource: true,
      });

      const outcome = settleThreadHandoffFailed(harness.deps, replacement.id, {
        code: "provider_start_failed",
        message: "Provider exited before the root turn started",
      });

      expect(outcome).toMatchObject({ applied: true });
      expect(
        getThreadHandoffByReplacementThreadId(harness.db, replacement.id),
      ).toMatchObject({
        status: "failed",
        failureCode: "provider_start_failed",
        failureMessage: "Provider exited before the root turn started",
      });
      expect(getThread(harness.db, source.id)?.archivedAt).toBeNull();
    });
  });
});
