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
  type EventLogShape,
  type Rng,
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
  measure(work: () => Promise<void>): Promise<number>;
  restore(): void;
}

function installRowCounter(): RowCounter {
  const probe = createMigratedConnection().$client;
  const prototype: PreparingDatabase = Object.getPrototypeOf(probe);
  probe.close();
  const originalPrepare = prototype.prepare;
  let counting = false;
  let rows = 0;
  const record = (count: number) => {
    if (counting) rows += count;
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
        record(result.length);
        return result;
      },
    });
    Object.defineProperty(statement, "get", {
      configurable: true,
      writable: true,
      value: (...params: unknown[]) => {
        const result = get(...params);
        record(result === undefined ? 0 : 1);
        return result;
      },
    });
    Object.defineProperty(statement, "iterate", {
      configurable: true,
      writable: true,
      value: function* (...params: unknown[]) {
        for (const row of iterate(...params)) {
          record(1);
          yield row;
        }
      },
    });
    return statement;
  };
  return {
    async measure(work) {
      rows = 0;
      counting = true;
      try {
        await work();
        return rows;
      } finally {
        counting = false;
      }
    },
    restore() {
      prototype.prepare = originalPrepare;
    },
  };
}

const HISTORY_EVENTS = 6_000;
const RECENT_STEPS = 600;
const PUSHES = 4;
const COST_SHAPE: EventLogShape = {
  ...MIXED_EVENT_LOG,
  deferredSteerAcceptanceChance: 0,
  lateBackgroundWork: false,
};

type ReadOperation = "push" | "refetchUnchanged" | "headState" | "olderPage";

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

function switchableRng(seed: number): { rng: Rng; reseed(next: number): void } {
  let source = createRng(seed);
  return {
    rng: () => source(),
    reseed(next) {
      source = createRng(next);
    },
  };
}

function buildThread(
  harness: TestAppHarness,
  historyEvents: number,
  runningTurn: boolean,
): ThreadLog {
  const random = switchableRng(11);
  const log = createThreadLog({
    harness,
    providerId: "codex",
    rng: random.rng,
    shape: COST_SHAPE,
  });
  while (log.eventCount() < historyEvents) log.bulk(250);
  log.finishOpenWork();
  random.reseed(23);
  log.bulk(RECENT_STEPS, { keepTurnOpen: runningTurn });
  if (!runningTurn) log.finishOpenWork();
  return log;
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

async function measureWarmReads(
  harness: TestAppHarness,
  log: ThreadLog,
): Promise<Record<ReadOperation, number[]>> {
  const threadId = log.threadId;
  const reads: Record<ReadOperation, number[]> = {
    push: [],
    refetchUnchanged: [],
    headState: [],
    olderPage: [],
  };
  const { body: latest } = await requestTimeline(
    harness,
    threadId,
    APP_SURFACE,
  );
  if (latest === null || isThreadTimelineDelta(latest)) {
    throw new Error("expected a full latest window");
  }
  const socket = createMockHubSocket();
  const target = {
    kind: "thread-timeline" as const,
    threadId,
    segmentLimit: null,
    deferContent: true,
  };
  harness.deps.hub.subscribe(socket, target, latest.tag);
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.messages.splice(0);
  try {
    for (let push = 0; push < PUSHES; push += 1) {
      log.step({ keepTurnOpen: true });
      reads.push.push(await counter.measure(() => waitForPush(socket)));
    }
  } finally {
    harness.deps.hub.unsubscribe(socket, target);
  }
  const { body: current } = await requestTimeline(
    harness,
    threadId,
    APP_SURFACE,
  );
  if (current === null || isThreadTimelineDelta(current)) {
    throw new Error("expected a full latest window");
  }
  reads.refetchUnchanged.push(
    await counter.measure(async () => {
      await requestTimeline(harness, threadId, APP_SURFACE, {
        afterTag: current.tag,
      });
    }),
  );
  reads.headState.push(
    await counter.measure(async () => {
      const response = await harness.app.request(
        `/api/v1/threads/${threadId}/head-state`,
      );
      expect(response.status).toBe(200);
      await readJson(response);
    }),
  );
  const cursor = current.timelinePage.olderCursor;
  if (cursor === null) throw new Error("expected older pages");
  reads.olderPage.push(
    await counter.measure(async () => {
      const { status } = await requestTimeline(harness, threadId, APP_SURFACE, {
        beforeAnchorSeq: String(cursor.anchorSeq),
        beforeAnchorId: cursor.anchorId,
      });
      expect(status).toBe(200);
    }),
  );
  return reads;
}

describe("timeline read cost as history grows", () => {
  it.each([
    ["finished recent turns", false],
    ["a running recent turn", true],
  ] as const)(
    "%s: warm reads do not read more rows when older history doubles",
    async (_label, runningTurn) => {
      const measure = (historyEvents: number) =>
        withTestHarness((harness) =>
          measureWarmReads(
            harness,
            buildThread(harness, historyEvents, runningTurn),
          ),
        );
      const smaller = await measure(HISTORY_EVENTS);
      const larger = await measure(HISTORY_EVENTS * 2);
      expect(larger).toEqual(smaller);
    },
    120_000,
  );
});
