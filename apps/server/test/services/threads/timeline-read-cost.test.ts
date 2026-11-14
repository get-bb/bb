import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createMigratedConnection } from "@bb/db/testing";
import { isThreadTimelineDelta } from "@bb/server-contract";
import { readJson } from "../../helpers/json.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import {
  APP_SURFACE,
  createRng,
  createThreadLog,
  MIXED_EVENT_LOG,
  requestTimeline,
  type ThreadLog,
} from "./timeline-guard-harness.js";

interface CountedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

interface PreparingDatabase {
  prepare(source: string): CountedStatement;
}

interface RowCounter {
  measure<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; rows: number; top: string }>;
  restore(): void;
}

function installRowCounter(): RowCounter {
  const probe = createMigratedConnection().$client;
  const prototype: PreparingDatabase = Object.getPrototypeOf(probe);
  probe.close();
  const originalPrepare = prototype.prepare;
  let counting = false;
  let rows = 0;
  let rowsBySource = new Map<string, number>();
  const record = (source: string, count: number) => {
    if (!counting || count === 0) return;
    rows += count;
    rowsBySource.set(source, (rowsBySource.get(source) ?? 0) + count);
  };
  prototype.prepare = function prepare(
    this: PreparingDatabase,
    source: string,
  ) {
    const statement = originalPrepare.call(this, source);
    const all = statement.all.bind(statement);
    const get = statement.get.bind(statement);
    const iterate = statement.iterate.bind(statement);
    Object.defineProperty(statement, "all", {
      configurable: true,
      writable: true,
      value: (...params: unknown[]) => {
        const result = all(...params);
        record(source, result.length);
        return result;
      },
    });
    Object.defineProperty(statement, "get", {
      configurable: true,
      writable: true,
      value: (...params: unknown[]) => {
        const result = get(...params);
        record(source, result === undefined ? 0 : 1);
        return result;
      },
    });
    Object.defineProperty(statement, "iterate", {
      configurable: true,
      writable: true,
      value: function* (...params: unknown[]) {
        for (const row of iterate(...params)) {
          record(source, 1);
          yield row;
        }
      },
    });
    return statement;
  };
  return {
    async measure(work) {
      rows = 0;
      rowsBySource = new Map();
      counting = true;
      try {
        const result = await work();
        const top = [...rowsBySource]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 5)
          .map(
            ([source, count]) =>
              `${count} rows: ${source.replace(/\s+/g, " ").slice(0, 220)}`,
          )
          .join("\n");
        return { result, rows, top };
      } finally {
        counting = false;
      }
    },
    restore() {
      prototype.prepare = originalPrepare;
    },
  };
}

const LONG_THREAD_EVENTS = 20_000;
const LONG_RUNNING_TURN_EVENTS = 4_000;
const OLDER_PAGES = 6;
const PUSHES = 5;

const ROWS_READ_BUDGET = {
  openLatest: 12_000,
  pageOlder: 6_000,
  push: 6_000,
  refetchUnchanged: 50,
  headState: 500,
};

type ReadOperation = keyof typeof ROWS_READ_BUDGET;

let counter: RowCounter;

beforeAll(() => {
  counter = installRowCounter();
});

afterAll(() => {
  counter.restore();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function buildLongThread(
  harness: TestAppHarness,
  runningTurn: boolean,
): ThreadLog {
  const log = createThreadLog({
    harness,
    rng: createRng(7),
    shape: MIXED_EVENT_LOG,
  });
  const historyEvents = runningTurn
    ? LONG_THREAD_EVENTS - LONG_RUNNING_TURN_EVENTS
    : LONG_THREAD_EVENTS;
  while (log.eventCount() < historyEvents) log.bulk(500);
  log.finishOpenWork();
  if (runningTurn) {
    while (log.eventCount() < LONG_THREAD_EVENTS) {
      log.bulk(200, { keepTurnOpen: true });
    }
  }
  return log;
}

async function expectWithinBudget<T>(
  operation: ReadOperation,
  work: () => Promise<T>,
): Promise<T> {
  const { result, rows, top } = await counter.measure(work);
  expect
    .soft(
      rows,
      `${operation} read ${rows} rows (budget ${ROWS_READ_BUDGET[operation]}):\n${top}`,
    )
    .toBeLessThanOrEqual(ROWS_READ_BUDGET[operation]);
  return result;
}

async function readLatest(
  harness: TestAppHarness,
  threadId: string,
  afterTag?: string,
) {
  const { body } = await requestTimeline(
    harness,
    threadId,
    APP_SURFACE,
    afterTag === undefined ? {} : { afterTag },
  );
  if (body === null) throw new Error("latest timeline request failed");
  return body;
}

async function waitForPush(
  socket: ReturnType<typeof createMockHubSocket>,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (
    !socket.messages.some(
      (message) => JSON.parse(message).type === "thread-timeline",
    )
  ) {
    if (performance.now() > deadline) throw new Error("no timeline push");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  socket.messages.splice(0);
}

async function expectReadsWithinBudget(
  harness: TestAppHarness,
  log: ThreadLog,
): Promise<void> {
  const threadId = log.threadId;
  const latest = await expectWithinBudget("openLatest", () =>
    readLatest(harness, threadId),
  );
  if (isThreadTimelineDelta(latest)) throw new Error("expected a full window");

  let cursor = latest.timelinePage.olderCursor;
  for (let page = 0; page < OLDER_PAGES && cursor !== null; page += 1) {
    const older = cursor;
    const { body } = await expectWithinBudget("pageOlder", () =>
      requestTimeline(harness, threadId, APP_SURFACE, {
        beforeAnchorSeq: String(older.anchorSeq),
        beforeAnchorId: older.anchorId,
      }),
    );
    if (body === null || isThreadTimelineDelta(body)) {
      throw new Error("older page request failed");
    }
    cursor = body.timelinePage.olderCursor;
  }
  expect(cursor, "the walk should still have older pages").not.toBeNull();

  await expectWithinBudget("refetchUnchanged", () =>
    readLatest(harness, threadId, latest.tag),
  );

  await expectWithinBudget("headState", async () => {
    const response = await harness.app.request(
      `/api/v1/threads/${threadId}/head-state`,
    );
    expect(response.status).toBe(200);
    return readJson(response);
  });

  const socket = createMockHubSocket();
  const target = {
    kind: "thread-timeline" as const,
    threadId,
    segmentLimit: null,
    deferContent: true,
  };
  harness.deps.hub.subscribe(socket, target, latest.tag);
  await discardPushesAfterSubscribe(socket);
  try {
    for (let push = 0; push < PUSHES; push += 1) {
      log.step({ keepTurnOpen: true });
      await expectWithinBudget("push", () => waitForPush(socket));
    }
  } finally {
    harness.deps.hub.unsubscribe(socket, target);
  }
}

async function discardPushesAfterSubscribe(
  socket: ReturnType<typeof createMockHubSocket>,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.messages.splice(0);
}

describe("timeline read cost on a very long thread", () => {
  it.each([
    ["finished history", false],
    ["a long running latest turn", true],
  ] as const)(
    "%s: each read stays under its rows-read budget",
    async (_label, runningTurn) => {
      await withTestHarness(async (harness) => {
        const log = buildLongThread(harness, runningTurn);
        await expectReadsWithinBudget(harness, log);
      });
    },
    120_000,
  );
});
