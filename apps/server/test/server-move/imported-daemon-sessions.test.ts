import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getSessionById, getThread, listEvents } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import {
  writeServerImportFile,
  type ServerImportFile,
} from "@bb/server-archive";
import { describe, expect, it } from "vitest";
import { disconnectImportedDaemonSessions } from "../../src/internal/session-owner-side-effects.js";
import { applyServerImportAtBoot } from "../../src/services/server-move/pending-boot.js";
import {
  seedStoredEvent,
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  testLogger,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const TASK_ITEM_ID = "task:wf-1";
const PROVIDER_THREAD_ID = "claude-session-1";

const MANUAL_IMPORT: ServerImportFile = {
  version: 1,
  kind: "manual",
  moveId: null,
  activationToken: null,
  sourceDataDir: "/home/old/.bb",
  sourceServerHostId: null,
  targetHostId: null,
  serverUrl: null,
  importedEntries: ["bb.db"],
  createdAt: 1,
  fixupsAppliedAt: null,
};

function backgroundTaskData(status: string, taskStatus: string) {
  return {
    providerThreadId: PROVIDER_THREAD_ID,
    item: {
      id: TASK_ITEM_ID,
      type: "backgroundTask",
      taskType: "local_workflow",
      description: "fixture workflow",
      status,
      taskStatus,
      skipTranscript: false,
      workflowName: "fixture-mini",
      usage: { totalTokens: 100, toolUses: 2, durationMs: 1500 },
    },
  };
}

function seedOpenBackgroundTask(
  harness: TestAppHarness,
  args: { environmentId: string; threadId: string },
): void {
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: 1,
    type: "turn/started",
    scope: turnScope("turn-1"),
    providerThreadId: PROVIDER_THREAD_ID,
    data: { providerThreadId: PROVIDER_THREAD_ID },
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: 2,
    type: "item/started",
    scope: turnScope("turn-1"),
    providerThreadId: PROVIDER_THREAD_ID,
    itemId: TASK_ITEM_ID,
    itemKind: "backgroundTask",
    data: backgroundTaskData("pending", "running"),
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence: 3,
    type: "item/backgroundTask/progress",
    scope: threadScope(),
    providerThreadId: PROVIDER_THREAD_ID,
    itemId: TASK_ITEM_ID,
    itemKind: "backgroundTask",
    data: backgroundTaskData("pending", "running"),
  });
}

describe("daemon sessions in an imported server snapshot", () => {
  it("closes them and settles their hosts' work at the first imported boot, and never again", async () => {
    await withTestHarness(async (harness) => {
      const {
        host,
        session,
        project,
        environment,
        thread: activeThread,
      } = seedThreadFixture(harness, { thread: { status: "active" } });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: activeThread.id,
        turnId: "turn-live-1",
      });
      const idleThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedOpenBackgroundTask(harness, {
        environmentId: environment.id,
        threadId: idleThread.id,
      });
      harness.hub.unregisterDaemon(session.id);
      await writeServerImportFile(harness.config.dataDir, MANUAL_IMPORT);

      const boot = await applyServerImportAtBoot({
        dataDir: harness.config.dataDir,
        db: harness.db,
        logger: testLogger,
        now: 1_000,
      });

      expect(boot.importedDaemonSessions).toEqual([
        { id: session.id, hostId: host.id },
      ]);
      expect(
        getSessionById(harness.db, { sessionId: session.id })?.status,
      ).toBe("active");

      disconnectImportedDaemonSessions(harness.deps, {
        sessions: boot.importedDaemonSessions,
      });

      expect(
        getSessionById(harness.db, { sessionId: session.id }),
      ).toMatchObject({ status: "closed", closeReason: "daemon-disconnect" });
      expect(harness.hub.hasDaemonForHost(host.id)).toBe(false);
      expect(getThread(harness.db, activeThread.id)?.status).toBe("error");
      expect(
        listEvents(harness.db, { threadId: activeThread.id })
          .filter((row) => row.type === "system/thread/interrupted")
          .map((row) => JSON.parse(row.data)),
      ).toEqual([
        { reason: "host-daemon-restarted", cause: "host-connection-lost" },
      ]);
      expect(
        listEvents(harness.db, { threadId: idleThread.id })
          .filter((row) => row.type === "item/backgroundTask/completed")
          .map((row) => JSON.parse(row.data)),
      ).toEqual([
        expect.objectContaining({
          item: expect.objectContaining({
            status: "interrupted",
            taskStatus: "stopped",
          }),
        }),
      ]);

      const nextBoot = await applyServerImportAtBoot({
        dataDir: harness.config.dataDir,
        db: harness.db,
        logger: testLogger,
        now: 2_000,
      });
      expect(nextBoot.importedDaemonSessions).toEqual([]);
    });
  });

  it("closes the imported sessions in runServer after the app exists and before the listener starts", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../../src/start-server.ts", import.meta.url)),
      "utf8",
    );
    const disconnect = source.indexOf("disconnectImportedDaemonSessions(");

    expect(disconnect).toBeGreaterThan(source.indexOf("createApp("));
    expect(disconnect).toBeLessThan(source.indexOf("startHttpListener({"));
    expect(source.slice(disconnect)).toContain(
      "sessions: serverImport.importedDaemonSessions",
    );
  });
});
