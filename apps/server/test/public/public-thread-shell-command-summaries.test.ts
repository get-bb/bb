import { describe, expect, it } from "vitest";
import { setAppSettings } from "@bb/db";
import { defaultAppSettings, turnScope } from "@bb/domain";
import {
  threadTimelineResponseSchema,
  timelineTurnSummaryDetailsResponseSchema,
  type TimelineRow,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

const COMMAND = "until gh pr checks 5487 | grep -qv pending; do sleep 30; done";
const SUMMARY = [
  { type: "search", command: COMMAND, query: "pending", path: null },
];

function seedTurnWithCommand(
  harness: TestAppHarness,
  completed: boolean,
): { threadId: string; turnId: string } {
  const { environment, thread } = seedThreadFixture(harness);
  const turnId = "turn-1";
  const turn = {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "p1",
    scope: turnScope(turnId),
  } as const;
  const item = {
    type: "commandExecution",
    id: "poll",
    command: COMMAND,
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
        aggregatedOutput: "All checks were successful\n",
      },
    },
  });
  if (completed) {
    seedEvent(harness.deps, {
      ...turn,
      sequence: 4,
      type: "turn/completed",
      data: { status: "completed" },
    });
  }
  return { threadId: thread.id, turnId };
}

function commandIntents(rows: readonly TimelineRow[]): unknown[] {
  return rows.flatMap((row) =>
    row.kind === "work" && row.workKind === "command"
      ? [row.activityIntents]
      : [],
  );
}

describe("shell command summaries", () => {
  it("follows the setting, including cached timeline responses", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedTurnWithCommand(harness, false);
      const readIntents = async () => {
        const response = await harness.app.request(
          `/api/v1/threads/${threadId}/timeline`,
        );
        expect(response.status).toBe(200);
        return commandIntents(
          threadTimelineResponseSchema.parse(await readJson(response)).rows,
        );
      };

      expect(await readIntents()).toEqual([SUMMARY]);
      setAppSettings(harness.db, {
        ...defaultAppSettings,
        summarizeShellCommands: false,
      });
      expect(await readIntents()).toEqual([[]]);
      setAppSettings(harness.db, defaultAppSettings);
      expect(await readIntents()).toEqual([SUMMARY]);
    });
  });

  it("follows the setting in completed turn details", async () => {
    await withTestHarness(async (harness) => {
      const { threadId, turnId } = seedTurnWithCommand(harness, true);
      const readIntents = async () => {
        const response = await harness.app.request(
          `/api/v1/threads/${threadId}/timeline/turn-summary-details?turnId=${turnId}&sourceSeqStart=1&sourceSeqEnd=4`,
        );
        expect(response.status).toBe(200);
        return commandIntents(
          timelineTurnSummaryDetailsResponseSchema.parse(
            await readJson(response),
          ).rows,
        );
      };

      expect(await readIntents()).toEqual([SUMMARY]);
      setAppSettings(harness.db, {
        ...defaultAppSettings,
        summarizeShellCommands: false,
      });
      expect(await readIntents()).toEqual([[]]);
    });
  });
});
