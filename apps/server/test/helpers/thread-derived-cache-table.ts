import { Hono } from "hono";
import { expect, vi } from "vitest";
import { z } from "zod";
import {
  encodeClientTurnRequestIdNumber,
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
  type ThreadStatus,
  type ThreadTimelineSubscriptionTarget,
} from "@bb/domain";
import {
  createConnection,
  getAppSettings,
  setAppSettings,
  setExperiments,
  threadConversationOutlines,
  threads,
  type DbConnection,
} from "@bb/db";
import { forgetThreadEventRewriteGenerations } from "@bb/db/testing";
import { eq } from "drizzle-orm";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  threadTimelineResponseSchema,
  threadTimelineSignalSchema,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { createServerErrorHandler } from "../../src/errors.js";
import { registerThreadDataRoutes } from "../../src/routes/threads/data.js";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "./mock-hub-socket.js";
import { seedEvent, seedThreadFixture } from "./seed.js";
import { withTestHarness, type TestAppHarness } from "./test-app.js";

export const PLUGIN_ID = "provider-goals";
export const PROVIDER_ID = "goals";
const GOAL_KIND = `${PLUGIN_ID}/goal`;
const PROVIDER_THREAD_ID = "provider-thread";
export const RETENTION_DEADLINE = Date.now() + 60 * 60_000;
const TURN_ONE_END = 10;
const SECOND_TURN_SEQUENCE = 13;
export const NEXT_SEQUENCE = 24;

export interface Server {
  db: DbConnection;
  fetch(path: string): Promise<Response>;
  hub: NotificationHub;
}

export interface Fixture {
  environmentId: string;
  hostId: string;
  projectId: string;
  threadId: string;
}

interface SurfaceContext {
  olderCursor: { anchorId: string; anchorSeq: number };
  threadId: string;
}

export interface Surface {
  name: string;
  path(context: SurfaceContext): string;
}

const timeline = (threadId: string, query: string) =>
  `/threads/${threadId}/timeline?${query}`;

export const LATEST_WINDOW: Surface = {
  name: "latest timeline window",
  path: ({ threadId }) =>
    timeline(threadId, "segmentLimit=20&deferContent=true"),
};
export const TURN_DETAILS: Surface = {
  name: "turn details",
  path: ({ threadId }) =>
    `/threads/${threadId}/timeline/turn-summary-details?turnId=turn-1&sourceSeqStart=2&sourceSeqEnd=${TURN_ONE_END}`,
};
export const OUTLINE: Surface = {
  name: "conversation outline",
  path: ({ threadId }) => `/threads/${threadId}/conversation-outline`,
};

export const THREAD_DATA_ROUTE_SURFACES: Record<
  string,
  readonly Surface[] | { excluded: string }
> = {
  "GET /threads/:id/plugin-metadata": [
    {
      name: "plugin metadata",
      path: ({ threadId }) =>
        `/threads/${threadId}/plugin-metadata?pluginId=${PLUGIN_ID}`,
    },
  ],
  "GET /threads/:id/context": [
    { name: "context", path: ({ threadId }) => `/threads/${threadId}/context` },
  ],
  "GET /threads/:id/head-state": [
    {
      name: "head state",
      path: ({ threadId }) => `/threads/${threadId}/head-state`,
    },
  ],
  "GET /threads/:id/timeline": [
    LATEST_WINDOW,
    {
      name: "latest timeline window with content",
      path: ({ threadId }) => timeline(threadId, "segmentLimit=20"),
    },
    {
      name: "latest timeline window with nested rows",
      path: ({ threadId }) =>
        timeline(threadId, "segmentLimit=20&includeNestedRows=true"),
    },
    {
      name: "older timeline page",
      path: ({ olderCursor, threadId }) =>
        timeline(
          threadId,
          `segmentLimit=1&beforeAnchorSeq=${olderCursor.anchorSeq}&beforeAnchorId=${encodeURIComponent(olderCursor.anchorId)}`,
        ),
    },
  ],
  "GET /threads/:id/conversation-outline": [
    OUTLINE,
    {
      name: "user conversation outline",
      path: ({ threadId }) =>
        `/threads/${threadId}/conversation-outline?role=user`,
    },
  ],
  "GET /threads/:id/messages/:seq": [
    {
      name: "message",
      path: ({ threadId }) =>
        `/threads/${threadId}/messages/${SECOND_TURN_SEQUENCE}?before=2&after=2`,
    },
  ],
  "GET /threads/:id/timeline/turn-summary-details": [TURN_DETAILS],
  "GET /threads/:id/output": [
    { name: "output", path: ({ threadId }) => `/threads/${threadId}/output` },
  ],
  "GET /threads/:id/queued-messages": [
    {
      name: "queued messages",
      path: ({ threadId }) => `/threads/${threadId}/queued-messages`,
    },
  ],
  "GET /threads/:id/prompt-history": [
    {
      name: "prompt history",
      path: ({ threadId }) => `/threads/${threadId}/prompt-history`,
    },
  ],
  "GET /threads/:id/events": [
    { name: "events", path: ({ threadId }) => `/threads/${threadId}/events` },
  ],
  "GET /threads/:id/events/wait": [
    {
      name: "event wait",
      path: ({ threadId }) =>
        `/threads/${threadId}/events/wait?type=turn/started&waitMs=0`,
    },
  ],
  "GET /threads/:id/status/wait": {
    excluded:
      "returns the thread response, whose runtime display reads live daemon sessions; no derived cache",
  },
  "GET /threads/:id/default-execution-options": [
    {
      name: "default execution options",
      path: ({ threadId }) => `/threads/${threadId}/default-execution-options`,
    },
  ],
  "GET /threads/:id/thread-storage/files": {
    excluded: "lists files on the thread's host over RPC; no derived cache",
  },
  "GET /threads/:id/thread-storage/location": {
    excluded: "resolves a path on the thread's host over RPC; no derived cache",
  },
  "GET /threads/:id/thread-storage/paths": {
    excluded: "lists paths on the thread's host over RPC; no derived cache",
  },
};

export const SURFACES: readonly Surface[] = Object.values(
  THREAD_DATA_ROUTE_SURFACES,
).flatMap((entry) => ("excluded" in entry ? [] : entry));

export function listThreadDataGetRoutes(harness: TestAppHarness): string[] {
  const app = new Hono();
  registerThreadDataRoutes(app, {
    ...harness.deps,
    hub: new NotificationHub(),
  });
  return [
    ...new Set(
      app.routes
        .filter((route) => route.method === "GET")
        .map((route) => `GET ${route.path}`),
    ),
  ].sort();
}

export function warmServer(harness: TestAppHarness): Server {
  return {
    db: harness.db,
    fetch: (path) => Promise.resolve(harness.app.request(`/api/v1${path}`)),
    hub: harness.hub,
  };
}

export function serverOver(harness: TestAppHarness, db: DbConnection): Server {
  const app = new Hono();
  app.onError(createServerErrorHandler(harness.deps.logger));
  const hub = new NotificationHub();
  registerThreadDataRoutes(app, { ...harness.deps, db, hub });
  return { db, fetch: (path) => Promise.resolve(app.request(path)), hub };
}

export function cloneDb(source: DbConnection): DbConnection {
  return createConnection(source.$client.serialize());
}

export interface SurfaceRead {
  body: unknown;
  status: number;
}

export async function readSurface(
  server: Server,
  path: string,
): Promise<SurfaceRead> {
  const response = await server.fetch(path);
  const text = await response.text();
  return {
    body: text.length === 0 ? null : JSON.parse(text),
    status: response.status,
  };
}

async function readAll(
  server: Server,
  paths: ReadonlyMap<string, string>,
): Promise<Map<string, SurfaceRead>> {
  const reads = new Map<string, SurfaceRead>();
  for (const [name, path] of paths) {
    reads.set(name, await readSurface(server, path));
  }
  return reads;
}

async function withUncachedServer<T>(
  harness: TestAppHarness,
  source: DbConnection,
  run: (server: Server) => Promise<T>,
): Promise<T> {
  const db = cloneDb(source);
  try {
    db.delete(threadConversationOutlines).run();
    return await run(serverOver(harness, db));
  } finally {
    db.$client.close();
  }
}

export type BooleanKey<T> = {
  [K in keyof T]-?: T[K] extends boolean ? K : never;
}[keyof T];

export function booleanKeysOf<T extends object>(value: T): BooleanKey<T>[] {
  return Object.entries(value).flatMap(([key, field]) =>
    typeof field === "boolean" ? [key as BooleanKey<T>] : [],
  );
}

export interface ProviderVersion {
  declaration: Partial<PluginProviderDeclaration>;
}

export const BASE_PROVIDER_DECLARATION: PluginProviderDeclaration = {
  id: PROVIDER_ID,
  displayName: "Goals",
  maintenance: { health: false, usage: false, installation: false },
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: true,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["full"],
    reasoningLevels: ["medium"],
  },
  composerActions: ["plan"],
  extensionKinds: {},
};

export function registerGoalsProvider(
  harness: TestAppHarness,
  declaration: PluginProviderDeclaration,
): { dispose(): void } {
  return harness.deps.providerRegistry.register({
    reportBridgeFailure: () => undefined,
    ...buildPluginProviderRegistration({
      iconHash: null,
      available: true,
      pluginId: PLUGIN_ID,
      declaration: validatePluginProviderDeclaration(declaration),
      readSettings: () => ({}),
    }),
    pluginId: PLUGIN_ID,
    iconNames: new Set<string>(),
  });
}

const PLAN_MENTION = {
  start: 0,
  end: 5,
  resource: {
    kind: "command",
    trigger: "/",
    name: "plan",
    source: "command",
    origin: "builtin",
    label: "plan",
    argumentHint: null,
  },
} as const;

export function seedUserMessage(
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
      input: [
        {
          type: "text",
          text,
          mentions: text.startsWith("/plan ") ? [PLAN_MENTION] : [],
        },
      ],
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

function seedTurnEvent(
  harness: TestAppHarness,
  fixture: Fixture,
  turnId: string,
  sequence: number,
  event: Pick<Parameters<typeof seedEvent>[1], "data" | "type">,
): void {
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope(turnId),
    sequence,
    ...event,
  });
}

function seedRetainedCommand(
  harness: TestAppHarness,
  fixture: Fixture,
  turnId: string,
  firstSequence: number,
): void {
  const command = {
    type: "commandExecution",
    id: `${turnId}-command`,
    command: "cat big.log",
    cwd: "/tmp/test-environment/src",
    approvalStatus: null,
  } as const;
  seedTurnEvent(harness, fixture, turnId, firstSequence, {
    type: "item/started",
    data: { item: { ...command, status: "pending" } },
  });
  seedTurnEvent(harness, fixture, turnId, firstSequence + 1, {
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

function seedFileChange(
  harness: TestAppHarness,
  fixture: Fixture,
  turnId: string,
  sequence: number,
): void {
  seedTurnEvent(harness, fixture, turnId, sequence, {
    type: "item/completed",
    data: {
      item: {
        type: "fileChange",
        id: `${turnId}-file-change`,
        approvalStatus: null,
        status: "completed",
        changes: [
          {
            path: "/tmp/test-environment/src/goal.ts",
            kind: "update",
            diff: "@@ -1 +1 @@\n-a\n+b\n",
          },
        ],
      },
    },
  });
}

function seedProviderUnhandled(
  harness: TestAppHarness,
  fixture: Fixture,
  turnId: string,
  sequence: number,
): void {
  seedTurnEvent(harness, fixture, turnId, sequence, {
    type: "provider/unhandled",
    data: {
      providerId: PROVIDER_ID,
      rawType: "goals/unknown",
      rawEvent: { jsonrpc: "2.0", method: "goals/unknown" },
    },
  });
}

function seedOwnershipChange(
  harness: TestAppHarness,
  fixture: Fixture,
  sequence: number,
  turnId: string | null,
): void {
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnId === null ? threadScope() : turnScope(turnId),
    sequence,
    type: "system/operation",
    data: {
      operation: "ownership_change",
      operationId: `op-assign-${sequence}`,
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

export function seedOpenSecondTurn(
  harness: TestAppHarness,
  fixture: Fixture,
  question: string,
): void {
  seedUserMessage(harness, fixture, SECOND_TURN_SEQUENCE, `/plan ${question}`);
  seedTurnEvent(harness, fixture, "turn-2", 14, {
    type: "turn/started",
    data: {},
  });
  seedTurnEvent(harness, fixture, "turn-2", 15, {
    type: "turn/input/accepted",
    data: {
      clientRequestId: encodeClientTurnRequestIdNumber({
        value: SECOND_TURN_SEQUENCE,
      }),
    },
  });
  seedRetainedCommand(harness, fixture, "turn-2", 16);
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    sequence: 18,
    type: "thread/extensionState/updated",
    scope: threadScope(),
    data: { kind: GOAL_KIND, payload: { status: "active" } },
  });
  seedProviderUnhandled(harness, fixture, "turn-2", 19);
  seedOwnershipChange(harness, fixture, 20, null);
  seedTurnEvent(harness, fixture, "turn-2", 21, {
    type: "thread/contextWindowUsage/updated",
    data: {
      contextWindowUsage: {
        usedTokens: 150_000,
        modelContextWindow: 200_000,
        estimated: false,
      },
    },
  });
  const usage = {
    totalTokens: 150_000,
    inputTokens: 10,
    cachedInputTokens: 149_990,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  seedTurnEvent(harness, fixture, "turn-2", 22, {
    type: "thread/tokenUsage/updated",
    data: {
      tokenUsage: {
        total: usage,
        last: usage,
        modelContextWindow: 200_000,
        promptCacheTtlMs: 3_600_000,
      },
    },
  });
  seedFileChange(harness, fixture, "turn-2", 23);
}

export const REWIND_CUTOFF_SEQUENCE = SECOND_TURN_SEQUENCE;

export function fillHistoryGaps(
  harness: TestAppHarness,
  fixture: Fixture,
): void {
  seedTurnEvent(harness, fixture, "turn-1", 8, {
    type: "item/completed",
    data: {
      item: {
        type: "commandExecution",
        id: "inserted-command",
        command: "echo inserted",
        cwd: "/tmp/test-environment/src",
        approvalStatus: null,
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "inserted",
      },
    },
  });
  seedUserMessage(harness, fixture, 11, "Inserted question");
}

export function seedThreadHistory(
  harness: TestAppHarness,
  options: { status: ThreadStatus } = { status: "active" },
): Fixture {
  const { environment, host, project, thread } = seedThreadFixture(harness, {
    thread: { providerId: PROVIDER_ID, status: options.status },
  });
  const fixture = {
    environmentId: environment.id,
    hostId: host.id,
    projectId: project.id,
    threadId: thread.id,
  };
  setAppSettings(harness.db, {
    ...getAppSettings(harness.db),
    keepHistoryAfterContextClear: true,
    showDiagnosticEvents: true,
  });
  setExperiments(harness.db, { compactExpiredCache: true });
  seedUserMessage(harness, fixture, 1, "First question");
  seedTurnEvent(harness, fixture, "turn-1", 2, {
    type: "turn/started",
    data: {},
  });
  seedRetainedCommand(harness, fixture, "turn-1", 3);
  seedFileChange(harness, fixture, "turn-1", 5);
  seedProviderUnhandled(harness, fixture, "turn-1", 6);
  seedOwnershipChange(harness, fixture, 7, "turn-1");
  seedTurnEvent(harness, fixture, "turn-1", 9, {
    type: "item/completed",
    data: {
      item: { type: "agentMessage", id: "answer-1", text: "First answer" },
    },
  });
  seedTurnEvent(harness, fixture, "turn-1", TURN_ONE_END, {
    type: "turn/completed",
    data: { status: "completed" },
  });
  seedEvent(harness.deps, {
    threadId: fixture.threadId,
    environmentId: fixture.environmentId,
    scope: threadScope(),
    sequence: 12,
    type: "system/operation",
    data: {
      operation: THREAD_CONTEXT_CLEAR_OPERATION,
      operationId: "clear",
      status: "completed",
      message: "Fresh context",
    },
  });
  seedOpenSecondTurn(harness, fixture, "Second question");
  return fixture;
}

const PUSH_TARGET_SEGMENT_LIMIT = 20;

function pushTarget(threadId: string): ThreadTimelineSubscriptionTarget {
  return {
    kind: "thread-timeline",
    threadId,
    segmentLimit: PUSH_TARGET_SEGMENT_LIMIT,
    deferContent: true,
  };
}

interface PushSubscriber {
  held(): ThreadTimelineResponse;
}

async function subscribeToPushes(
  server: Server,
  threadId: string,
  latestWindowPath: string,
): Promise<PushSubscriber> {
  let held = threadTimelineResponseSchema.parse(
    (await readSurface(server, latestWindowPath)).body,
  );
  const socket = createMockHubSocket();
  server.hub.subscribe(socket, pushTarget(threadId), held.tag);
  return {
    held() {
      for (const message of socket.messages.splice(0)) {
        const parsed: unknown = JSON.parse(message);
        const signal = threadTimelineSignalSchema.safeParse(parsed);
        if (!signal.success) continue;
        const { timeline: pushed } = signal.data;
        const next = isThreadTimelineDelta(pushed)
          ? applyThreadTimelineDelta(held, pushed)
          : pushed;
        if (next === null) {
          throw new Error("a pushed delta did not apply to the held window");
        }
        held = next;
      }
      return held;
    },
  };
}

export interface ChangeContext {
  fixture: Fixture;
  harness: TestAppHarness;
  readWarm(): Promise<void>;
  replaceProvider(declaration: PluginProviderDeclaration): void;
  restart(): void;
}

export interface InvalidatingChange {
  name: string;
  change(context: ChangeContext): void | Promise<void>;
}

const olderCursorSchema = z.object({
  timelinePage: z.object({
    olderCursor: z.object({ anchorSeq: z.number(), anchorId: z.string() }),
  }),
});

export async function expectCachedReadsMatchUncachedBuilds(
  change: InvalidatingChange["change"],
  expected: { changesOutput: boolean },
): Promise<void> {
  try {
    await withTestHarness(async (harness) => {
      let provider = registerGoalsProvider(harness, BASE_PROVIDER_DECLARATION);
      const fixture = seedThreadHistory(harness);
      let warm = warmServer(harness);
      const restartedDbs: DbConnection[] = [];
      try {
        const { olderCursor } = olderCursorSchema.parse(
          (
            await readSurface(
              warm,
              timeline(fixture.threadId, "segmentLimit=1"),
            )
          ).body,
        ).timelinePage;
        const paths = new Map(
          SURFACES.map((surface) => [
            surface.name,
            surface.path({ olderCursor, threadId: fixture.threadId }),
          ]),
        );
        const before = await readAll(warm, paths);
        for (const [name, read] of before) {
          expect(read.status, `${name}: ${JSON.stringify(read.body)}`).toBe(
            200,
          );
        }
        expect(before).toEqual(
          await withUncachedServer(harness, harness.db, (cold) =>
            readAll(cold, paths),
          ),
        );
        const latestWindowPath = paths.get(LATEST_WINDOW.name) ?? "";
        let subscriber = await subscribeToPushes(
          warm,
          fixture.threadId,
          latestWindowPath,
        );
        let restarted = false;
        await change({
          fixture,
          harness,
          readWarm: async () => {
            await readAll(warm, paths);
          },
          replaceProvider: (declaration) => {
            provider.dispose();
            provider = registerGoalsProvider(harness, declaration);
          },
          restart: () => {
            forgetThreadEventRewriteGenerations();
            const db = cloneDb(warm.db);
            restartedDbs.push(db);
            warm = serverOver(harness, db);
            restarted = true;
          },
        });
        if (restarted) {
          subscriber = await subscribeToPushes(
            warm,
            fixture.threadId,
            latestWindowPath,
          );
        }
        const uncached = await withUncachedServer(harness, warm.db, (cold) =>
          readAll(cold, paths),
        );
        if (expected.changesOutput) {
          expect(uncached).not.toEqual(before);
        }
        const cached = await readAll(warm, paths);
        for (const name of paths.keys()) {
          expect(cached.get(name), name).toEqual(uncached.get(name));
        }
        const uncachedWindow = uncached.get(LATEST_WINDOW.name);
        if (uncachedWindow?.status === 200) {
          warm.hub.notifyThread(fixture.threadId, ["events-appended"]);
          await expect
            .poll(() => subscriber.held(), { timeout: 3_000 })
            .toEqual(uncachedWindow.body);
        }
      } finally {
        for (const db of restartedDbs) db.$client.close();
      }
    });
  } finally {
    vi.restoreAllMocks();
    forgetThreadEventRewriteGenerations();
  }
}

export function setThreadStatus(
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
