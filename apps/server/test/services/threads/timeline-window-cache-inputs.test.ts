import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { threadScope, turnScope } from "@bb/domain";
import { getThread } from "@bb/db";
import {
  isThreadTimelineDelta,
  timelineRowChildren,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { buildPluginProviderRegistration } from "../../../src/services/providers/plugin-provider-registration.js";
import {
  createThreadTimelineWindows,
  type ThreadTimelineWindowRequest,
} from "../../../src/services/threads/thread-timeline-windows.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const desktop: ThreadTimelineWindowRequest = {
  deferContent: true,
  includeNestedRows: false,
  page: { kind: "latest", segmentLimit: 20 },
};

const PLUGIN_ID = "provider-goals";
const PROVIDER_ID = "goals";
const GOAL_KIND = `${PLUGIN_ID}/goal`;

function full(response: ThreadTimelineReadResponse): ThreadTimelineResponse {
  if (isThreadTimelineDelta(response)) {
    throw new Error("expected a full timeline window");
  }
  return response;
}

function readLatest(
  harness: TestAppHarness,
  windows: ReturnType<typeof createThreadTimelineWindows>,
  threadId: string,
): ThreadTimelineResponse {
  const thread = getThread(harness.deps.db, threadId);
  if (thread === null) throw new Error(`missing thread ${threadId}`);
  return full(windows.read(thread, desktop, undefined));
}

function commandAvailability(
  rows: readonly TimelineRow[],
  callId: string,
): string | undefined {
  for (const row of rows) {
    if (
      row.kind === "work" &&
      row.workKind === "command" &&
      row.callId === callId
    ) {
      return row.outputPreview?.experimental_fullOutputAvailability;
    }
    const children = timelineRowChildren(row);
    if (children !== null) {
      const nested = commandAvailability(children, callId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function registerGoalsProvider(
  harness: TestAppHarness,
  declareGoalState: boolean,
): { dispose(): void } {
  return harness.deps.providerRegistry.register({
    ...buildPluginProviderRegistration({
      iconHash: null,
      available: true,
      pluginId: PLUGIN_ID,
      declaration: validatePluginProviderDeclaration({
        id: PROVIDER_ID,
        displayName: "Goals",
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
        extensionKinds: declareGoalState
          ? { goal: { state: z.object({ status: z.string() }) } }
          : {},
      }),
      readSettings: () => ({}),
    }),
    pluginId: PLUGIN_ID,
    iconNames: new Set<string>(),
  });
}

describe("timeline window cache inputs", () => {
  it("rebuilds a cached window once a retained output passes its retention deadline", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const turn = {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread",
        scope: turnScope("turn-1"),
      } as const;
      const truncatedAt = Date.now() + 60_000;
      const item = {
        type: "commandExecution",
        id: "cmd-retained",
        command: "cat big.log",
        cwd: "/tmp",
        approvalStatus: null,
      } as const;
      seedEvent(harness.deps, {
        ...turn,
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 2,
        type: "item/started",
        data: { item: { ...item, status: "pending" } },
      });
      seedEvent(harness.deps, {
        ...turn,
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            ...item,
            status: "completed",
            exitCode: 0,
            aggregatedOutput: "head…tail",
            truncation: {
              aggregatedOutput: {
                originalLength: 50_000,
                retainedHeadLength: 4,
                retainedTailLength: 4,
                truncatedAt,
              },
            },
          },
        },
      });
      const windows = createThreadTimelineWindows(harness.deps);

      const before = readLatest(harness, windows, thread.id);
      expect(commandAvailability(before.rows, "cmd-retained")).toBe(
        "available",
      );
      expect(readLatest(harness, windows, thread.id)).toBe(before);

      const now = vi.spyOn(Date, "now").mockReturnValue(truncatedAt);
      try {
        expect(
          commandAvailability(
            readLatest(harness, windows, thread.id).rows,
            "cmd-retained",
          ),
        ).toBe("retention-expired");
      } finally {
        now.mockRestore();
      }
    });
  });

  it("re-reads head extension states after a provider update declares a new state kind", async () => {
    await withTestHarness(async (harness) => {
      const withoutGoalState = registerGoalsProvider(harness, false);
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { providerId: PROVIDER_ID },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "hello" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread",
        sequence: 2,
        type: "thread/extensionState/updated",
        scope: threadScope(),
        data: { kind: GOAL_KIND, payload: { status: "active" } },
      });
      const windows = createThreadTimelineWindows(harness.deps);

      expect(readLatest(harness, windows, thread.id).extensionStates).toEqual(
        {},
      );

      withoutGoalState.dispose();
      registerGoalsProvider(harness, true);

      expect(readLatest(harness, windows, thread.id).extensionStates).toEqual({
        [GOAL_KIND]: { status: "active" },
      });
    });
  });
});
