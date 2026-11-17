import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type ThreadStatus,
} from "@bb/domain";
import {
  createConnection,
  deleteThreadEventSuffixInTransaction,
  getAppSettings,
  setAppSettings,
  threadConversationOutlines,
  threads,
  updateThread,
  type DbConnection,
} from "@bb/db";
import { forgetThreadEventRewriteGenerations } from "@bb/db/testing";
import { eq } from "drizzle-orm";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { registerThreadDataRoutes } from "../../src/routes/threads/data.js";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PLUGIN_ID = "provider-goals";
const PROVIDER_ID = "goals";
const GOAL_KIND = `${PLUGIN_ID}/goal`;
const PROVIDER_THREAD_ID = "provider-thread";
const RETENTION_DEADLINE = Date.now() + 60 * 60_000;
const LARGEST_CACHE_ENTRY_LIMIT = 512;
const NEXT_SEQUENCE = 15;

type Fetch = (path: string) => Promise<Response>;

interface Server {
  fetch: Fetch;
  db: DbConnection;
}

interface Surface {
  name: string;
  path(threadId: string): string;
}

const LATEST_WINDOW: Surface = {
  name: "latest timeline window",
  path: (threadId) =>
    `/threads/${threadId}/timeline?segmentLimit=20&deferContent=true`,
};
const TURN_DETAILS: Surface = {
  name: "turn details",
  path: (threadId) =>
    `/threads/${threadId}/timeline/turn-summary-details?turnId=turn-1&sourceSeqStart=2&sourceSeqEnd=6`,
};
const OUTLINE: Surface = {
  name: "conversation outline",
  path: (threadId) => `/threads/${threadId}/conversation-outline`,
};
const SURFACES = [LATEST_WINDOW, TURN_DETAILS, OUTLINE] as const;

interface Fixture {
  environmentId: string;
  threadId: string;
}

interface ProviderVersion {
  displayName: string;
  declareGoalState: boolean;
}

interface ChangeContext {
  fixture: Fixture;
  harness: TestAppHarness;
  replaceProvider(version: ProviderVersion): void;
  restart(): void;
}

interface InvalidatingChange {
  name: string;
  change(context: ChangeContext): void | Promise<void>;
}

function warmServer(harness: TestAppHarness): Server {
  return {
    db: harness.db,
    fetch: (path) => Promise.resolve(harness.app.request(`/api/v1${path}`)),
  };
}

function serverOver(harness: TestAppHarness, db: DbConnection): Server {
  const app = new Hono();
  registerThreadDataRoutes(app, {
    ...harness.deps,
    db,
    hub: new NotificationHub(),
  });
  return { db, fetch: (path) => Promise.resolve(app.request(path)) };
}

function cloneDb(source: DbConnection): DbConnection {
  return createConnection(source.$client.serialize());
}

async function readSurface(server: Server, path: string): Promise<unknown> {
  const response = await server.fetch(path);
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body;
}

async function readAll(
  server: Server,
  threadId: string,
): Promise<Record<string, unknown>> {
  const read: Record<string, unknown> = {};
  for (const surface of SURFACES) {
    read[surface.name] = await readSurface(server, surface.path(threadId));
  }
  return read;
}

async function readUncached(
  harness: TestAppHarness,
  source: DbConnection,
  threadId: string,
): Promise<Record<string, unknown>> {
  const db = cloneDb(source);
  try {
    db.delete(threadConversationOutlines).run();
    return await readAll(serverOver(harness, db), threadId);
  } finally {
    db.$client.close();
  }
}

function registerGoalsProvider(
  harness: TestAppHarness,
  version: ProviderVersion,
): { dispose(): void } {
  return harness.deps.providerRegistry.register({
    ...buildPluginProviderRegistration({
      iconHash: null,
      available: true,
      pluginId: PLUGIN_ID,
      declaration: validatePluginProviderDeclaration({
        id: PROVIDER_ID,
        displayName: version.displayName,
        maintenance: { health: false, usage: false, installation: false },
        capabilities: {
          supportsServiceTier: false,
          supportsNativeUserQuestion: false,
          fork: "none",
          supportsManualCompaction: false,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ["full"],
          reasoningLevels: ["medium"],
        },
        composerActions: [],
        extensionKinds: version.declareGoalState
          ? { goal: { state: z.object({ status: z.string() }) } }
          : {},
      }),
      readSettings: () => ({}),
    }),
    pluginId: PLUGIN_ID,
    iconNames: new Set<string>(),
  });
}

function seedUserMessage(
  harness: TestAppHarness,
  fixture: Fixture,
  sequence: number,
  text: string,
): void {
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: sequence }),
      input: [{ type: "text", text }],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
}

function seedGoalState(
  harness: TestAppHarness,
  fixture: Fixture,
  sequence: number,
  status: string,
): void {
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    sequence,
    type: "thread/extensionState/updated",
    scope: threadScope(),
    data: { kind: GOAL_KIND, payload: { status } },
  });
}

function seedRetainedCommand(
  harness: TestAppHarness,
  fixture: Fixture,
  turnId: string,
  firstSequence: number,
): void {
  const turn = {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope(turnId),
  } as const;
  const command = {
    type: "commandExecution",
    id: `${turnId}-command`,
    command: "cat big.log",
    cwd: "/tmp",
    approvalStatus: null,
  } as const;
  seedEvent(harness.deps, {
    ...turn,
    sequence: firstSequence,
    type: "item/started",
    data: { item: { ...command, status: "pending" } },
  });
  seedEvent(harness.deps, {
    ...turn,
    sequence: firstSequence + 1,
    type: "item/completed",
    data: {
      item: {
        ...command,
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "head…tail",
        truncation: {
          aggregatedOutput: {
            originalLength: 50_000,
            retainedHeadLength: 4,
            retainedTailLength: 4,
            truncatedAt: RETENTION_DEADLINE,
          },
        },
      },
    },
  });
}

function seedTurnStart(
  harness: TestAppHarness,
  fixture: Fixture,
  turnId: string,
  sequence: number,
): void {
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope(turnId),
    sequence,
    type: "turn/started",
    data: {},
  });
}

function seedOpenSecondTurn(
  harness: TestAppHarness,
  fixture: Fixture,
  question: string,
): void {
  seedUserMessage(harness, fixture, 8, question);
  seedTurnStart(harness, fixture, "turn-2", 9);
  seedRetainedCommand(harness, fixture, "turn-2", 10);
  seedGoalState(harness, fixture, 12, "active");
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope("turn-2"),
    sequence: 13,
    type: "provider/unhandled",
    data: {
      providerId: PROVIDER_ID,
      rawType: "goals/unknown",
      rawEvent: { jsonrpc: "2.0", method: "goals/unknown" },
    },
  });
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    scope: threadScope(),
    sequence: 14,
    type: "system/operation",
    data: {
      operation: "ownership_change",
      operationId: "op-assign",
      status: "completed",
      message: "",
      metadata: {
        action: "assign",
        nextParentThreadId: "thr_parent",
        nextParentThreadTitle: "Parent",
        previousParentThreadId: null,
        previousParentThreadTitle: null,
      },
    },
  });
}

function seedThreadHistory(harness: TestAppHarness): Fixture {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: PROVIDER_ID },
  });
  const fixture = { environmentId: environment.id, threadId: thread.id };
  setAppSettings(harness.db, {
    ...getAppSettings(harness.db),
    showDiagnosticEvents: true,
  });
  const turn = {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope("turn-1"),
  } as const;
  seedUserMessage(harness, fixture, 1, "First question");
  seedTurnStart(harness, fixture, "turn-1", 2);
  seedRetainedCommand(harness, fixture, "turn-1", 3);
  seedEvent(harness.deps, {
    ...turn,
    sequence: 5,
    type: "item/completed",
    data: {
      item: { type: "agentMessage", id: "answer-1", text: "First answer" },
    },
  });
  seedEvent(harness.deps, {
    ...turn,
    sequence: 6,
    type: "turn/completed",
    data: { status: "completed" },
  });
  seedOpenSecondTurn(harness, fixture, "Second question");
  return fixture;
}

function setThreadStatus(
  harness: TestAppHarness,
  threadId: string,
  status: ThreadStatus,
): void {
  harness.db
    .update(threads)
    .set({ status })
    .where(eq(threads.id, threadId))
    .run();
}

function rewindAndReplay(harness: TestAppHarness, fixture: Fixture): void {
  harness.db.transaction((tx) => {
    deleteThreadEventSuffixInTransaction(tx, {
      threadId: fixture.threadId,
      cutoffSequence: 8,
      oldMaxSequence: NEXT_SEQUENCE - 1,
    });
  });
  seedOpenSecondTurn(harness, fixture, "Edited question");
}

const INVALIDATING_CHANGES: readonly InvalidatingChange[] = [
  {
    name: "an appended event",
    change: ({ harness, fixture }) =>
      seedUserMessage(harness, fixture, NEXT_SEQUENCE, "Third question"),
  },
  {
    name: "an event filled in below the head",
    change: ({ harness, fixture }) =>
      seedUserMessage(harness, fixture, 7, "Inserted question"),
  },
  {
    name: "a status change",
    change: ({ harness, fixture }) =>
      setThreadStatus(harness, fixture.threadId, "error"),
  },
  {
    name: "a title change",
    change: ({ harness, fixture }) => {
      updateThread(harness.db, harness.hub, fixture.threadId, {
        title: "Renamed thread",
      });
    },
  },
  {
    name: "a completed-turn display setting change",
    change: ({ harness }) =>
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        providerCompletedTurnDisplay: { [PROVIDER_ID]: "flat" },
      }),
  },
  {
    name: "a shell command summary setting change",
    change: ({ harness }) => {
      const settings = getAppSettings(harness.db);
      setAppSettings(harness.db, {
        ...settings,
        summarizeShellCommands: !settings.summarizeShellCommands,
      });
    },
  },
  {
    name: "a diagnostic events setting change",
    change: ({ harness }) =>
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        showDiagnosticEvents: false,
      }),
  },
  {
    name: "a provider update that declares a new state kind",
    change: ({ replaceProvider }) =>
      replaceProvider({ displayName: "Goals", declareGoalState: true }),
  },
  {
    name: "a provider update that renames the provider",
    change: ({ replaceProvider }) =>
      replaceProvider({ displayName: "Goals Pro", declareGoalState: false }),
  },
  {
    name: "the clock passing a retained-output deadline",
    change: () => {
      vi.spyOn(Date, "now").mockReturnValue(RETENTION_DEADLINE);
    },
  },
  {
    name: "a server restart after a rewind that reuses sequences",
    change: ({ harness, fixture, restart }) => {
      rewindAndReplay(harness, fixture);
      restart();
    },
  },
  {
    name: "a server restart after an event filled in below the head",
    change: ({ harness, fixture, restart }) => {
      seedUserMessage(harness, fixture, 7, "Inserted question");
      restart();
    },
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  forgetThreadEventRewriteGenerations();
});

describe("thread-derived caches serve what an uncached build would", () => {
  it.each(INVALIDATING_CHANGES)("after $name", async ({ change }) => {
    await withTestHarness(async (harness) => {
      let provider = registerGoalsProvider(harness, {
        displayName: "Goals",
        declareGoalState: false,
      });
      const fixture = seedThreadHistory(harness);
      let warm = warmServer(harness);
      const restartedDbs: DbConnection[] = [];
      try {
        const before = await readAll(warm, fixture.threadId);
        expect(before).toEqual(
          await readUncached(harness, harness.db, fixture.threadId),
        );
        await change({
          fixture,
          harness,
          replaceProvider: (version) => {
            provider.dispose();
            provider = registerGoalsProvider(harness, version);
          },
          restart: () => {
            forgetThreadEventRewriteGenerations();
            const db = cloneDb(warm.db);
            restartedDbs.push(db);
            warm = serverOver(harness, db);
          },
        });
        const uncached = await readUncached(harness, warm.db, fixture.threadId);
        expect(uncached).not.toEqual(before);
        const cached = await readAll(warm, fixture.threadId);
        for (const surface of SURFACES) {
          expect(cached[surface.name], surface.name).toEqual(
            uncached[surface.name],
          );
        }
      } finally {
        for (const db of restartedDbs) db.$client.close();
      }
    });
  });
});

async function countStatements(server: Server, path: string): Promise<number> {
  const prepare = vi.spyOn(server.db.$client, "prepare");
  try {
    await readSurface(server, path);
    return prepare.mock.calls.length;
  } finally {
    prepare.mockRestore();
  }
}

describe("thread-derived caches keep entries that are still current", () => {
  it.each(SURFACES)(
    "keeps an idle thread's $name while another thread streams",
    async (surface) => {
      await withTestHarness(async (harness) => {
        registerGoalsProvider(harness, {
          displayName: "Goals",
          declareGoalState: false,
        });
        const idle = seedThreadHistory(harness);
        const streaming = seedThreadHistory(harness);
        const warm = warmServer(harness);
        const idlePath = surface.path(idle.threadId);
        const missStatements = await countStatements(warm, idlePath);
        const hitStatements = await countStatements(warm, idlePath);
        expect(hitStatements).toBeLessThan(missStatements);
        for (
          let sequence = NEXT_SEQUENCE;
          sequence < NEXT_SEQUENCE + LARGEST_CACHE_ENTRY_LIMIT + 8;
          sequence += 1
        ) {
          seedUserMessage(harness, streaming, sequence, `Message ${sequence}`);
          await readSurface(warm, surface.path(streaming.threadId));
        }
        expect(await countStatements(warm, idlePath)).toBe(hitStatements);
      });
    },
  );

  it("keeps an older timeline page across appends", async () => {
    await withTestHarness(async (harness) => {
      registerGoalsProvider(harness, {
        displayName: "Goals",
        declareGoalState: false,
      });
      const fixture = seedThreadHistory(harness);
      const warm = warmServer(harness);
      const latest = z
        .object({
          timelinePage: z.object({
            olderCursor: z.object({
              anchorSeq: z.number(),
              anchorId: z.string(),
            }),
          }),
        })
        .parse(
          await readSurface(
            warm,
            `/threads/${fixture.threadId}/timeline?segmentLimit=1`,
          ),
        );
      const { anchorSeq, anchorId } = latest.timelinePage.olderCursor;
      const olderPath = `/threads/${fixture.threadId}/timeline?segmentLimit=1&beforeAnchorSeq=${anchorSeq}&beforeAnchorId=${encodeURIComponent(anchorId)}`;
      const missStatements = await countStatements(warm, olderPath);
      const hitStatements = await countStatements(warm, olderPath);
      expect(hitStatements).toBeLessThan(missStatements);
      seedUserMessage(harness, fixture, NEXT_SEQUENCE, "Third question");
      expect(await countStatements(warm, olderPath)).toBe(hitStatements);
      const uncached = cloneDb(harness.db);
      try {
        expect(await readSurface(warm, olderPath)).toEqual(
          await readSurface(serverOver(harness, uncached), olderPath),
        );
      } finally {
        uncached.$client.close();
      }
    });
  });
});
