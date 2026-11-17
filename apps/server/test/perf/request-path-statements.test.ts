import Database from "better-sqlite3";
import {
  buildHistoryFixture,
  type HistoryFixture,
} from "@bb/db/history-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  forgetQueuedCommand,
  listPendingQueuedCommandsForHost,
  reportQueuedCommandSuccess,
  type QueuedCommand,
} from "../helpers/commands.js";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { turnScope, type ThreadEvent } from "@bb/domain";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { seedSession } from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const LINEAR_GROWTH_LIMIT = 2.5;
const RESPONSE_BYTES_GROWTH_LIMIT = 1.5;
const RESPONSE_BYTES_SLACK = 4_096;
const FIXTURE_BUILD_TIMEOUT_MS = 120_000;

interface WorldSize {
  historyTurns: number;
  longTurnSteps: number;
  neighborThreads: number;
}

type AxisName = "thread history" | "turn size";

interface GrowthAxis {
  name: AxisName;
  small: WorldSize;
  large: WorldSize;
}

const GROWTH_AXES: readonly GrowthAxis[] = [
  {
    name: "thread history",
    small: { historyTurns: 100, longTurnSteps: 20, neighborThreads: 20 },
    large: { historyTurns: 200, longTurnSteps: 20, neighborThreads: 40 },
  },
  {
    name: "turn size",
    small: { historyTurns: 100, longTurnSteps: 750, neighborThreads: 20 },
    large: { historyTurns: 100, longTurnSteps: 1_500, neighborThreads: 20 },
  },
];

function describeWorld(size: WorldSize): string {
  return `${size.historyTurns} turns, ${size.longTurnSteps}-step long turns, ${size.neighborThreads} other threads`;
}

interface StatementCounter {
  watch(database: Database.Database): void;
  record(work: () => Promise<void>): Promise<string[]>;
}

interface SizedServer {
  harness: TestAppHarness;
  fixture: HistoryFixture;
  counter: StatementCounter;
  sessionId: string;
  received: { bytes: number };
}

interface RequestPath {
  name: string;
  linearStatements?: Partial<Record<AxisName, string>>;
  linearResponse?: Partial<Record<AxisName, string>>;
  run(server: SizedServer): Promise<void>;
}

const EXECUTE_METHODS = ["run", "get", "all", "iterate"] as const;
const originalPrepare = Database.prototype.prepare;
const statementObservers = new Set<
  (database: Database.Database, sql: string) => void
>();

Database.prototype.prepare = function prepare(
  this: Database.Database,
  source: string,
) {
  const statement = originalPrepare.call(this, source);
  const database = this;
  for (const method of EXECUTE_METHODS) {
    const original = statement[method].bind(statement) as (
      ...params: unknown[]
    ) => unknown;
    Object.defineProperty(statement, method, {
      configurable: true,
      writable: true,
      value: (...params: unknown[]) => {
        for (const observe of statementObservers) observe(database, source);
        return original(...params);
      },
    });
  }
  return statement;
} as typeof Database.prototype.prepare;

function createStatementCounter(): StatementCounter {
  let watched: Database.Database | null = null;
  let statements: string[] | null = null;
  statementObservers.add((database, sql) => {
    if (statements !== null && database === watched) statements.push(sql);
  });
  return {
    watch(database) {
      watched = database;
    },
    async record(work) {
      const recorded: string[] = [];
      statements = recorded;
      try {
        await work();
      } finally {
        statements = null;
      }
      return recorded;
    },
  };
}

async function startSizedServer(size: WorldSize): Promise<SizedServer> {
  const counter = createStatementCounter();
  const harness = await createTestAppHarness();
  counter.watch(harness.db.$client);
  const fixture = buildHistoryFixture(harness.db, {
    historyTurns: size.historyTurns,
    longTurnSteps: size.longTurnSteps,
    neighborThreads: size.neighborThreads,
    neighborTurns: 5,
    providerId: "codex",
  });
  const session = seedSession(harness.deps, fixture.hostId);
  return {
    harness,
    fixture,
    counter,
    sessionId: session.id,
    received: { bytes: 0 },
  };
}

async function readOk(
  server: SizedServer,
  response: Response | Promise<Response>,
): Promise<string> {
  const resolved = await response;
  const body = await resolved.text();
  if (!resolved.ok) throw new Error(`${resolved.status} ${body}`);
  server.received.bytes += Buffer.byteLength(body);
  return body;
}

async function get(server: SizedServer, path: string): Promise<void> {
  await readOk(server, server.harness.app.request(`/api/v1${path}`));
}

async function postDaemonEvents(
  server: SizedServer,
  events: HostDaemonEventEnvelope[],
): Promise<void> {
  await readOk(
    server,
    server.harness.app.request("/internal/session/events", {
      method: "POST",
      headers: internalAuthHeaders(server.harness),
      body: JSON.stringify({
        sessionId: server.sessionId,
        eventGroups: groupHostDaemonEvents(events),
      }),
    }),
  );
}

async function answerDaemon(
  server: SizedServer,
  queued: QueuedCommand,
): Promise<void> {
  const { command } = queued;
  if (command.type === "thread.stop") {
    await reportQueuedCommandSuccess(server.harness, queued, {
      providerCheckpointId: null,
    });
  } else if (command.type === "thread.rewind.prepare") {
    await reportQueuedCommandSuccess(server.harness, queued, {
      providerThreadId: server.fixture.providerThreadId,
    });
  } else {
    forgetQueuedCommand(queued);
  }
}

async function withDaemon(
  server: SizedServer,
  work: Promise<unknown>,
): Promise<void> {
  let settled = false;
  const finished = work.finally(() => {
    settled = true;
  });
  while (!settled) {
    for (const queued of listPendingQueuedCommandsForHost(
      server.fixture.hostId,
    )) {
      await answerDaemon(server, queued);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await finished;
}

function post(
  server: SizedServer,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  return withDaemon(
    server,
    readOk(
      server,
      server.harness.app.request(`/api/v1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function firstTurn(server: SizedServer) {
  const turn = server.fixture.turns[0];
  if (turn === undefined) throw new Error("Expected fixture turns");
  return turn;
}

const followUpInput = [
  { type: "text", text: "Then update the docs.", mentions: [] },
];

function statementShape(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\?(?:\s*,\s*\?)*/g, "?…")
    .replace(/\(\?…\)(?:\s*,\s*\(\?…\))+/g, "(?…)…");
}

function grownStatements(small: string[], large: string[]): string[] {
  const counts = new Map<string, number>();
  for (const sql of large.map(statementShape)) {
    counts.set(sql, (counts.get(sql) ?? 0) + 1);
  }
  for (const sql of small.map(statementShape)) {
    counts.set(sql, (counts.get(sql) ?? 0) - 1);
  }
  return [...counts]
    .filter(([, delta]) => delta > 0)
    .sort((left, right) => right[1] - left[1])
    .map(
      ([sql, delta]) => `+${delta}: ${sql.replace(/\s+/g, " ").slice(0, 300)}`,
    );
}

function streamedTurn(server: SizedServer): HostDaemonEventEnvelope[] {
  const { threadId, providerThreadId } = server.fixture;
  const scope = turnScope("streamed-turn");
  const item = {
    type: "agentMessage" as const,
    id: "streamed-turn-reply",
    text: "",
  };
  const events: ThreadEvent[] = [
    { type: "turn/started", threadId, providerThreadId, scope },
    {
      type: "item/started",
      threadId,
      providerThreadId,
      scope,
      item,
    },
    {
      type: "item/agentMessage/delta",
      threadId,
      providerThreadId,
      scope,
      itemId: item.id,
      delta: "Done.",
    },
    {
      type: "item/completed",
      threadId,
      providerThreadId,
      scope,
      item: { ...item, text: "Done." },
    },
    {
      type: "turn/completed",
      threadId,
      providerThreadId,
      scope,
      status: "completed",
      providerCheckpointId: "streamed-turn-checkpoint",
    },
  ];
  return events.map((event) => ({ threadId, event }));
}

function newItemsInLiveTurn(server: SizedServer): HostDaemonEventEnvelope[] {
  const { liveTurn } = server.fixture;
  const { threadId, providerThreadId } = liveTurn;
  const scope = turnScope(liveTurn.turnId);
  const events = Array.from({ length: 3 }, (_, index): ThreadEvent[] => {
    const item = {
      type: "commandExecution" as const,
      id: `${liveTurn.turnId}-streamed-${index}`,
      command: "git status",
      cwd: "/workspace/bb",
      approvalStatus: null,
    };
    return [
      {
        type: "item/started",
        threadId,
        providerThreadId,
        scope,
        item: { ...item, status: "pending" },
      },
      {
        type: "item/completed",
        threadId,
        providerThreadId,
        scope,
        item: { ...item, status: "completed", exitCode: 0 },
      },
    ];
  }).flat();
  return events.map((event) => ({ threadId, event }));
}

const timelineTagSchema = z.object({ tag: z.string() });

function streamedIntoLiveTurn(server: SizedServer): HostDaemonEventEnvelope[] {
  const { liveTurn } = server.fixture;
  const { threadId, providerThreadId } = liveTurn;
  const scope = turnScope(liveTurn.turnId);
  const deltas: ThreadEvent[] = Array.from({ length: 10 }, (_, index) =>
    index % 2 === 0
      ? {
          type: "item/agentMessage/delta",
          threadId,
          providerThreadId,
          scope,
          itemId: liveTurn.streamingMessageItemId,
          delta: "Still checking. ",
        }
      : {
          type: "item/commandExecution/outputDelta",
          threadId,
          providerThreadId,
          scope,
          itemId: liveTurn.runningCommandItemId,
          delta: "\u2713 test/query-plan-audit.test.ts (6 tests) 12ms\n",
        },
  );
  const events: ThreadEvent[] = [
    ...deltas,
    {
      type: "item/completed",
      threadId,
      providerThreadId,
      scope,
      item: {
        type: "commandExecution",
        id: liveTurn.runningCommandItemId,
        command: "pnpm exec turbo run test --filter=@bb/db",
        cwd: "/workspace/bb",
        status: "completed",
        approvalStatus: null,
        exitCode: 0,
        durationMs: 1800,
      },
    },
  ];
  return events.map((event) => ({ threadId, event }));
}

const REQUEST_PATHS: readonly RequestPath[] = [
  {
    name: "thread list",
    linearResponse: {
      "thread history":
        "Lists every thread, and the longer world has twice as many",
    },
    run: (server) => get(server, "/threads"),
  },
  {
    name: "thread detail",
    run: (server) => get(server, `/threads/${server.fixture.threadId}`),
  },
  {
    name: "timeline open",
    run: (server) =>
      get(server, `/threads/${server.fixture.threadId}/timeline`),
  },
  {
    name: "conversation outline",
    linearResponse: {
      "thread history": "Lists every message in the thread",
      "turn size":
        "Lists every message, including the commentary in long turns",
    },
    run: (server) =>
      get(server, `/threads/${server.fixture.threadId}/conversation-outline`),
  },
  {
    name: "thread context",
    run: (server) => get(server, `/threads/${server.fixture.threadId}/context`),
  },
  {
    name: "head state",
    run: (server) =>
      get(server, `/threads/${server.fixture.threadId}/head-state`),
  },
  {
    name: "queued messages",
    run: (server) =>
      get(server, `/threads/${server.fixture.threadId}/queued-messages`),
  },
  {
    name: "oldest turn details",
    linearResponse: { "turn size": "Returns every row of the turn" },
    run: (server) => {
      const turn = firstTurn(server);
      const query = new URLSearchParams({
        turnId: turn.turnId,
        sourceSeqStart: String(turn.requestSequence),
        sourceSeqEnd: String(turn.completedSequence),
      });
      return get(
        server,
        `/threads/${server.fixture.threadId}/timeline/turn-summary-details?${query}`,
      );
    },
  },
  {
    name: "oldest message",
    run: (server) =>
      get(
        server,
        `/threads/${server.fixture.threadId}/messages/${firstTurn(server).requestSequence}`,
      ),
  },
  {
    name: "thread search",
    run: (server) => get(server, "/threads/search?query=failing%20build"),
  },
  {
    name: "thread count",
    run: (server) => get(server, "/threads/count"),
  },
  {
    name: "running threads",
    run: (server) => get(server, "/threads/running"),
  },
  {
    name: "prompt history",
    run: (server) =>
      get(server, `/threads/${server.fixture.threadId}/prompt-history`),
  },
  {
    name: "oldest events page",
    run: (server) => {
      const query = new URLSearchParams({
        afterSeq: "0",
        beforeSeq: String(firstTurn(server).completedSequence + 1),
        limit: "100",
        order: "asc",
      });
      return get(server, `/threads/${server.fixture.threadId}/events?${query}`);
    },
  },
  {
    name: "child summary",
    run: (server) =>
      get(server, `/threads/${server.fixture.threadId}/child-summary`),
  },
  {
    name: "default execution options",
    run: (server) =>
      get(
        server,
        `/threads/${server.fixture.threadId}/default-execution-options`,
      ),
  },
  {
    name: "mark read and unread",
    run: async (server) => {
      await post(server, `/threads/${server.fixture.threadId}/read`, {});
      await post(server, `/threads/${server.fixture.threadId}/unread`, {});
    },
  },
  {
    name: "pin and unpin",
    run: async (server) => {
      await post(server, `/threads/${server.fixture.threadId}/pin`, {});
      await post(server, `/threads/${server.fixture.threadId}/unpin`, {});
    },
  },
  {
    name: "daemon streams a turn",
    run: (server) => postDaemonEvents(server, streamedTurn(server)),
  },
  {
    name: "periodic sweeps",
    linearStatements: {
      "thread history":
        "Queues and runs pruning work for every thread with new events, up to each sweep's per-run budget",
      "turn size":
        "Prunes resolved items in the long turns one at a time, up to each sweep's per-run budget",
    },
    run: (server) =>
      runPeriodicSweeps({
        ...server.harness.deps,
        pluginSchedules: server.harness.pluginService,
        plugins: server.harness.pluginService,
      }),
  },
  {
    name: "send while a retry is queued",
    run: (server) =>
      post(server, `/threads/${server.fixture.threadId}/send`, {
        mode: "queue-if-active",
        input: followUpInput,
      }),
  },
  {
    name: "edit the last message",
    run: (server) =>
      post(server, `/threads/${server.fixture.threadId}/edit-message`, {
        operationId: "edit-last-message",
        input: followUpInput,
      }),
  },
  {
    name: "stop",
    run: (server) =>
      post(server, `/threads/${server.fixture.threadId}/stop`, {}),
  },
  {
    name: "live thread detail",
    run: (server) =>
      get(server, `/threads/${server.fixture.liveTurn.threadId}`),
  },
  {
    name: "live timeline open",
    run: (server) =>
      get(server, `/threads/${server.fixture.liveTurn.threadId}/timeline`),
  },
  {
    name: "live conversation outline",
    linearResponse: {
      "turn size":
        "Lists every message, including the commentary in long turns",
    },
    run: (server) =>
      get(
        server,
        `/threads/${server.fixture.liveTurn.threadId}/conversation-outline`,
      ),
  },
  {
    name: "live thread context",
    run: (server) =>
      get(server, `/threads/${server.fixture.liveTurn.threadId}/context`),
  },
  {
    name: "live head state",
    run: (server) =>
      get(server, `/threads/${server.fixture.liveTurn.threadId}/head-state`),
  },
  {
    name: "live turn details",
    linearResponse: { "turn size": "Returns every row of the turn" },
    run: (server) => {
      const { liveTurn } = server.fixture;
      const query = new URLSearchParams({
        turnId: liveTurn.turnId,
        sourceSeqStart: String(liveTurn.requestSequence),
        sourceSeqEnd: String(liveTurn.latestSequence),
      });
      return get(
        server,
        `/threads/${liveTurn.threadId}/timeline/turn-summary-details?${query}`,
      );
    },
  },
  {
    name: "timeline delta while an open long turn streams",
    run: async (server) => {
      const path = `/threads/${server.fixture.liveTurn.threadId}/timeline`;
      const { tag } = timelineTagSchema.parse(
        JSON.parse(
          await readOk(server, server.harness.app.request(`/api/v1${path}`)),
        ),
      );
      await postDaemonEvents(server, newItemsInLiveTurn(server));
      await get(server, `${path}?afterTag=${encodeURIComponent(tag)}`);
    },
  },
  {
    name: "daemon streams into an open long turn",
    run: (server) => postDaemonEvents(server, streamedIntoLiveTurn(server)),
  },
  {
    name: "send to a running thread",
    run: (server) =>
      post(server, `/threads/${server.fixture.liveTurn.threadId}/send`, {
        mode: "queue-if-active",
        input: followUpInput,
      }),
  },
  {
    name: "stop a running thread",
    run: (server) =>
      post(server, `/threads/${server.fixture.liveTurn.threadId}/stop`, {}),
  },
  {
    name: "fork",
    linearStatements: {
      "thread history": "Copies every source event into the fork, in batches",
      "turn size": "Copies every source event into the fork, in batches",
    },
    run: (server) =>
      post(server, "/threads/fork", {
        sourceThreadId: server.fixture.threadId,
      }),
  },
];

describe.each(GROWTH_AXES)("request path costs as $name grows", (axis) => {
  let small: SizedServer;
  let large: SizedServer;

  beforeAll(async () => {
    small = await startSizedServer(axis.small);
    large = await startSizedServer(axis.large);
  }, FIXTURE_BUILD_TIMEOUT_MS);

  afterAll(async () => {
    await small.harness.cleanup();
    await large.harness.cleanup();
  });

  it.each(REQUEST_PATHS)(
    "$name runs a statement count and returns a response that do not grow",
    async (path) => {
      small.received.bytes = 0;
      const smallStatements = await small.counter.record(() => path.run(small));
      large.received.bytes = 0;
      const largeStatements = await large.counter.record(() => path.run(large));
      const summary = `${path.name}: ${smallStatements.length} statements and ${small.received.bytes} response bytes with ${describeWorld(axis.small)}, ${largeStatements.length} and ${large.received.bytes} with ${describeWorld(axis.large)}`;
      expect(largeStatements.length).toBeGreaterThan(0);
      if (path.linearResponse?.[axis.name] === undefined) {
        expect(large.received.bytes, summary).toBeLessThanOrEqual(
          small.received.bytes * RESPONSE_BYTES_GROWTH_LIMIT +
            RESPONSE_BYTES_SLACK,
        );
      }
      if (path.linearStatements?.[axis.name] === undefined) {
        expect(
          grownStatements(smallStatements, largeStatements),
          summary,
        ).toEqual([]);
      } else {
        expect(largeStatements.length, summary).toBeLessThanOrEqual(
          smallStatements.length * LINEAR_GROWTH_LIMIT,
        );
      }
    },
  );
});

afterAll(() => {
  statementObservers.clear();
  Database.prototype.prepare = originalPrepare;
});
