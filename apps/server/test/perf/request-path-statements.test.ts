import type { SlowDbQueryLogger } from "@bb/db";
import {
  buildHistoryFixture,
  type HistoryFixture,
} from "@bb/db/history-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  forgetQueuedCommand,
  listPendingQueuedCommandsForHost,
  reportQueuedCommandSuccess,
  type QueuedCommand,
} from "../helpers/commands.js";
import { seedSession } from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const SMALL_HISTORY_TURNS = 100;
const LARGE_HISTORY_TURNS = 200;
const LINEAR_GROWTH_LIMIT = 2.5;

interface StatementCounter {
  logger: SlowDbQueryLogger;
  record(work: () => Promise<void>): Promise<string[]>;
}

interface SizedServer {
  harness: TestAppHarness;
  fixture: HistoryFixture;
  counter: StatementCounter;
}

interface RequestPath {
  name: string;
  linearInHistory?: string;
  run(server: SizedServer): Promise<void>;
}

function createStatementCounter(): StatementCounter {
  let statements: string[] | null = null;
  return {
    logger: {
      info(fields) {
        if (statements !== null && fields.operation !== "transaction") {
          statements.push(fields.sql);
        }
      },
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

async function startSizedServer(historyTurns: number): Promise<SizedServer> {
  const counter = createStatementCounter();
  const harness = await createTestAppHarness({
    statementLogger: counter.logger,
  });
  const fixture = buildHistoryFixture(harness.db, {
    historyTurns,
    providerId: "codex",
  });
  seedSession(harness.deps, fixture.hostId);
  return { harness, fixture, counter };
}

async function expectOk(response: Response | Promise<Response>) {
  const resolved = await response;
  if (!resolved.ok) {
    throw new Error(`${resolved.status} ${await resolved.text()}`);
  }
}

function get(server: SizedServer, path: string): Promise<void> {
  return expectOk(server.harness.app.request(`/api/v1${path}`));
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
  work: Promise<void>,
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
    expectOk(
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

function grownStatements(small: string[], large: string[]): string[] {
  const counts = new Map<string, number>();
  for (const sql of large) counts.set(sql, (counts.get(sql) ?? 0) + 1);
  for (const sql of small) counts.set(sql, (counts.get(sql) ?? 0) - 1);
  return [...counts]
    .filter(([, delta]) => delta > 0)
    .sort((left, right) => right[1] - left[1])
    .map(
      ([sql, delta]) => `+${delta}: ${sql.replace(/\s+/g, " ").slice(0, 300)}`,
    );
}

const REQUEST_PATHS: readonly RequestPath[] = [
  {
    name: "thread list",
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
    name: "fork",
    linearInHistory: "Copies every source event into the fork, in batches",
    run: (server) =>
      post(server, "/threads/fork", {
        sourceThreadId: server.fixture.threadId,
      }),
  },
];

describe("request path statement counts", () => {
  let small: SizedServer;
  let large: SizedServer;

  beforeAll(async () => {
    small = await startSizedServer(SMALL_HISTORY_TURNS);
    large = await startSizedServer(LARGE_HISTORY_TURNS);
  });

  afterAll(async () => {
    await small.harness.cleanup();
    await large.harness.cleanup();
  });

  it.each(REQUEST_PATHS)(
    "$name runs a statement count that does not grow with thread history",
    async (path) => {
      const smallStatements = await small.counter.record(() => path.run(small));
      const largeStatements = await large.counter.record(() => path.run(large));
      const summary = `${path.name}: ${smallStatements.length} statements at ${SMALL_HISTORY_TURNS} turns, ${largeStatements.length} at ${LARGE_HISTORY_TURNS}`;
      expect(largeStatements.length).toBeGreaterThan(0);
      if (path.linearInHistory === undefined) {
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
