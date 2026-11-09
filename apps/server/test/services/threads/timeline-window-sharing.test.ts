import { describe, expect, it, vi } from "vitest";
import { defaultFeatureFlags, threadScope, turnScope } from "@bb/domain";
import { getThread } from "@bb/db";
import {
  isThreadTimelineDelta,
  timelineRowChildren,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type TimelinePaginationCursor,
  type TimelineRow,
} from "@bb/server-contract";
import {
  createThreadTimelineWindows,
  type ThreadTimelineWindowRequest,
} from "../../../src/services/threads/thread-timeline-windows.js";
import type { ThreadTimelineBuildProfile } from "../../../src/services/threads/timeline.js";
import { clearTimelineOrderingContextCache } from "../../../src/services/threads/timeline-context-order.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { clearCrossBuildTimelineCaches } from "../../provider-corpus/corpus-harness.js";

const builds = vi.hoisted(() => ({
  profiles: [] as ThreadTimelineBuildProfile[],
}));

vi.mock("../../../src/services/threads/timeline.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../../src/services/threads/timeline.js")
    >();
  return {
    ...original,
    buildThreadTimelineWithProfile: (
      ...args: Parameters<typeof original.buildThreadTimelineWithProfile>
    ) => {
      const result = original.buildThreadTimelineWithProfile(...args);
      builds.profiles.push(result.profile);
      return result;
    },
  };
});

const desktop: ThreadTimelineWindowRequest = {
  deferContent: true,
  includeNestedRows: false,
  page: { kind: "latest", segmentLimit: 20 },
};
const phone: ThreadTimelineWindowRequest = {
  ...desktop,
  page: { kind: "latest", segmentLimit: 8 },
};
const variants: Record<string, ThreadTimelineWindowRequest> = {
  cliLog: { ...desktop, deferContent: false },
  nested: { ...desktop, deferContent: false, includeNestedRows: true },
};

function full(response: ThreadTimelineReadResponse): ThreadTimelineResponse {
  if (isThreadTimelineDelta(response)) {
    throw new Error("expected a full timeline window");
  }
  return response;
}

function delegationChildRows(
  response: ThreadTimelineResponse,
): (number | null)[] {
  const counts: (number | null)[] = [];
  const visit = (rows: readonly TimelineRow[]) => {
    for (const row of rows) {
      if (row.kind === "work" && row.workKind === "delegation") {
        counts.push(row.childRows === null ? null : row.childRows.length);
      }
      const children = timelineRowChildren(row);
      if (children !== null) visit(children);
    }
  };
  visit(response.rows);
  return counts;
}

function stagesOfLastBuild(): Set<string> {
  const profile = builds.profiles.at(-1);
  if (profile === undefined) throw new Error("expected a build");
  return new Set(profile.stageTimings.map((timing) => timing.stage));
}

function freshRead(
  harness: TestAppHarness,
  threadId: string,
  request: ThreadTimelineWindowRequest,
): ThreadTimelineResponse {
  clearCrossBuildTimelineCaches(harness.deps.db);
  clearTimelineOrderingContextCache(harness.deps.db);
  return full(
    createThreadTimelineWindows(harness.deps).read(
      requireThread(harness, threadId),
      request,
      undefined,
    ),
  );
}

function requireThread(harness: TestAppHarness, threadId: string) {
  const thread = getThread(harness.deps.db, threadId);
  if (thread === null) throw new Error(`missing thread ${threadId}`);
  return thread;
}

function seedUserMessages(
  harness: TestAppHarness,
  args: { environmentId: string; sequences: number[]; threadId: string },
): void {
  for (const sequence of args.sequences) {
    seedEvent(harness.deps, {
      threadId: args.threadId,
      environmentId: args.environmentId,
      sequence,
      type: "system/manager/user_message",
      scope: threadScope(),
      data: { text: `message ${sequence}` },
    });
  }
}

function seedTurn(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    firstSequence: number;
    threadId: string;
    turnId: string;
  },
): number {
  const scope = {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-thread",
    scope: turnScope(args.turnId),
  };
  let sequence = args.firstSequence;
  seedEvent(harness.deps, {
    ...scope,
    sequence: sequence++,
    type: "turn/started",
    data: {},
  });
  for (let index = 0; index < 4; index += 1) {
    seedEvent(harness.deps, {
      ...scope,
      sequence: sequence++,
      type: "item/completed",
      data: {
        item: {
          type: "commandExecution",
          id: `${args.turnId}-command-${index}`,
          command: `echo ${index}`,
          cwd: "/tmp",
          status: "completed",
          approvalStatus: null,
          aggregatedOutput: `${"output ".repeat(40)}${index}\n`,
          exitCode: 0,
          durationMs: 1,
        },
      },
    });
  }
  seedEvent(harness.deps, {
    ...scope,
    sequence: sequence++,
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: `${args.turnId}-reply`,
        text: `reply in ${args.turnId}`,
      },
    },
  });
  return sequence;
}

function seedSettledDelegation(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    firstSequence: number;
    threadId: string;
    turnId: string;
  },
): void {
  const scope = {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: "provider-thread",
    scope: turnScope(args.turnId),
  };
  const delegationId = `${args.turnId}-delegation`;
  const delegation = (status: "pending" | "completed") => ({
    item: {
      type: "delegation" as const,
      id: delegationId,
      childRef: "child-thread",
      label: "Audit",
      status,
      background: false,
    },
  });
  let sequence = args.firstSequence;
  seedEvent(harness.deps, {
    ...scope,
    sequence: sequence++,
    type: "item/started",
    data: delegation("pending"),
  });
  seedEvent(harness.deps, {
    ...scope,
    sequence: sequence++,
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: `${args.turnId}-child-reply`,
        text: "child reply",
        parentToolCallId: delegationId,
      },
    },
  });
  seedEvent(harness.deps, {
    ...scope,
    sequence: sequence++,
    type: "item/completed",
    data: delegation("completed"),
  });
}

function olderPageRequest(
  cursor: TimelinePaginationCursor,
): ThreadTimelineWindowRequest {
  return {
    ...desktop,
    page: { kind: "older", beforeCursor: cursor, segmentLimit: 20 },
  };
}

describe("timeline window caches", () => {
  it("serves an event gap-filled below the head sequence", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedUserMessages(harness, {
        environmentId: environment.id,
        sequences: [1, 3],
        threadId: thread.id,
      });
      const windows = createThreadTimelineWindows(harness.deps);
      const before = full(windows.read(thread, desktop, undefined));
      expect(JSON.stringify(before.rows)).not.toContain("message 2");

      seedUserMessages(harness, {
        environmentId: environment.id,
        sequences: [2],
        threadId: thread.id,
      });
      const after = full(windows.read(thread, desktop, undefined));
      expect(after.maxSeq).toBe(before.maxSeq);
      expect(JSON.stringify(after.rows)).toContain("message 2");
      expect(after).toEqual(freshRead(harness, thread.id, desktop));
    });
  });

  it("keeps older pages cached while the thread grows and rebuilds them after a rewrite", async () => {
    await withTestHarness(
      {
        featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 2 },
      },
      async (harness) => {
        const { environment, thread } = seedThreadFixture(harness);
        seedUserMessages(harness, {
          environmentId: environment.id,
          sequences: [1, 2, 4, 5, 6, 7, 8],
          threadId: thread.id,
        });
        const windows = createThreadTimelineWindows(harness.deps);
        const cursors: TimelinePaginationCursor[] = [];
        let page = full(windows.read(thread, desktop, undefined));
        while (page.timelinePage.olderCursor !== null) {
          cursors.push(page.timelinePage.olderCursor);
          page = full(
            windows.read(
              thread,
              olderPageRequest(page.timelinePage.olderCursor),
              undefined,
            ),
          );
        }
        expect(cursors.length).toBeGreaterThan(1);
        const olderPages = cursors.map((cursor) =>
          full(windows.read(thread, olderPageRequest(cursor), undefined)),
        );

        seedUserMessages(harness, {
          environmentId: environment.id,
          sequences: [9],
          threadId: thread.id,
        });
        const grown = requireThread(harness, thread.id);
        full(windows.read(grown, desktop, undefined));
        const buildsBeforeOlderReads = builds.profiles.length;
        const afterAppend = cursors.map((cursor) =>
          full(windows.read(grown, olderPageRequest(cursor), undefined)),
        );
        expect(builds.profiles.length).toBe(buildsBeforeOlderReads);
        expect(afterAppend).toEqual(olderPages);

        seedUserMessages(harness, {
          environmentId: environment.id,
          sequences: [3],
          threadId: thread.id,
        });
        const afterRewrite = cursors.map((cursor) =>
          full(windows.read(grown, olderPageRequest(cursor), undefined)),
        );
        expect(builds.profiles.length).toBe(
          buildsBeforeOlderReads + cursors.length,
        );
        expect(afterRewrite).toEqual(
          cursors.map((cursor) =>
            freshRead(harness, thread.id, olderPageRequest(cursor)),
          ),
        );
      },
    );
  });

  it("shares the selection and projection between the desktop and phone windows", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { providerId: "codex" },
      });
      let sequence = 1;
      for (let turn = 1; turn <= 3; turn += 1) {
        seedUserMessages(harness, {
          environmentId: environment.id,
          sequences: [sequence++],
          threadId: thread.id,
        });
        sequence = seedTurn(harness, {
          environmentId: environment.id,
          firstSequence: sequence,
          threadId: thread.id,
          turnId: `turn-${turn}`,
        });
      }
      const windows = createThreadTimelineWindows(harness.deps);
      full(windows.read(thread, desktop, undefined));
      const phoneWindow = full(windows.read(thread, phone, undefined));
      const phoneStages = stagesOfLastBuild();
      expect(phoneStages.has("group-context-query")).toBe(false);
      expect(phoneStages.has("thread-view-projection")).toBe(false);
      expect(phoneStages.has("thread-view-rows")).toBe(false);
      expect(phoneWindow).toEqual(freshRead(harness, thread.id, phone));

      seedTurn(harness, {
        environmentId: environment.id,
        firstSequence: sequence,
        threadId: thread.id,
        turnId: "turn-4",
      });
      const grown = requireThread(harness, thread.id);
      const desktopAfter = full(windows.read(grown, desktop, undefined));
      const phoneAfter = full(windows.read(grown, phone, undefined));
      expect(stagesOfLastBuild().has("thread-view-rows")).toBe(false);
      expect(desktopAfter).toEqual(freshRead(harness, thread.id, desktop));
      expect(phoneAfter).toEqual(freshRead(harness, thread.id, phone));
    });
  });

  it("derives the summary, CLI and nested windows from the app window's projection", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { providerId: "codex" },
      });
      seedUserMessages(harness, {
        environmentId: environment.id,
        sequences: [1],
        threadId: thread.id,
      });
      seedTurn(harness, {
        environmentId: environment.id,
        firstSequence: 2,
        threadId: thread.id,
        turnId: "turn-1",
      });
      const windows = createThreadTimelineWindows(harness.deps);
      full(windows.read(thread, desktop, undefined));
      const rowShape = (request: ThreadTimelineWindowRequest) =>
        `${request.includeNestedRows}:${request.deferContent}`;
      const materializedShapes = new Set([rowShape(desktop)]);
      for (const [name, request] of Object.entries(variants)) {
        const response = full(windows.read(thread, request, undefined));
        const stages = stagesOfLastBuild();
        expect(stages.has("thread-view-projection"), name).toBe(false);
        expect(stages.has("thread-view-rows"), name).toBe(
          !materializedShapes.has(rowShape(request)),
        );
        materializedShapes.add(rowShape(request));
        expect(response, name).toEqual(freshRead(harness, thread.id, request));
      }
    });
  });

  it("keeps settled subagent children in the CLI window built after the app window", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { providerId: "codex" },
      });
      seedUserMessages(harness, {
        environmentId: environment.id,
        sequences: [1],
        threadId: thread.id,
      });
      const next = seedTurn(harness, {
        environmentId: environment.id,
        firstSequence: 2,
        threadId: thread.id,
        turnId: "turn-1",
      });
      seedSettledDelegation(harness, {
        environmentId: environment.id,
        firstSequence: next,
        threadId: thread.id,
        turnId: "turn-1",
      });
      const windows = createThreadTimelineWindows(harness.deps);
      const app = full(windows.read(thread, desktop, undefined));
      const cliLog = full(windows.read(thread, variants.cliLog!, undefined));
      expect(stagesOfLastBuild().has("thread-view-projection")).toBe(false);
      expect(delegationChildRows(app)).toEqual([null]);
      expect(delegationChildRows(cliLog)).toEqual([1]);
      expect(cliLog).toEqual(freshRead(harness, thread.id, variants.cliLog!));
    });
  });

  it("drops a deleted thread's cached windows", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedUserMessages(harness, {
        environmentId: environment.id,
        sequences: [1],
        threadId: thread.id,
      });
      const windows = createThreadTimelineWindows(harness.deps);
      windows.read(thread, desktop, undefined);
      const cachedBuilds = builds.profiles.length;
      windows.read(thread, desktop, undefined);
      expect(builds.profiles.length).toBe(cachedBuilds);
      harness.deps.hub.notifyThread(thread.id, ["thread-deleted"]);
      windows.read(thread, desktop, undefined);
      expect(builds.profiles.length).toBe(cachedBuilds + 1);
    });
  });
});
