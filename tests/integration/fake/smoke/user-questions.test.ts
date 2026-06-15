import { createFakeAdapter } from "@bb/agent-runtime/test";
import {
  isUserQuestionPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionResolution,
  type UserQuestionPendingInteractionPayload,
} from "@bb/domain";
import type {
  TimelineFeedRow,
  TimelineFeedWorkRow,
  TimelineRow,
  TimelineWorkRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  getThreadOutput,
  getThreadTimeline,
  getThreadTimelineRowDetail,
  getThreadTimelineTurnSummaryDetails,
  listThreadInteractions,
  resolveThreadInteraction,
  sendTextMessage,
  type PublicApiClient,
} from "../../helpers/api.js";
import {
  waitForEventType,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  createProjectFixture,
  createReadyThread,
  TURN_TIMEOUT_MS,
} from "./shared.js";

interface UserQuestionInteraction extends PendingInteraction {
  payload: UserQuestionPendingInteractionPayload;
}

type TimelineFeedQuestionWorkRow = Extract<
  TimelineFeedWorkRow,
  { workKind: "question" }
>;
type TimelineQuestionWorkRow = Extract<TimelineWorkRow, { workKind: "question" }>;
type TimelineQuestionRow = TimelineFeedQuestionWorkRow | TimelineQuestionWorkRow;
type TimelineQuestionSearchRow = TimelineFeedRow | TimelineRow;

interface CollectQuestionRowsArgs {
  api: PublicApiClient;
  rows: readonly TimelineQuestionSearchRow[];
  threadId: string;
}

function isUserQuestionInteraction(
  interaction: PendingInteraction,
): interaction is UserQuestionInteraction {
  return isUserQuestionPendingInteractionPayload(interaction.payload);
}

function isQuestionWorkRow(
  row: TimelineQuestionSearchRow,
): row is TimelineQuestionRow {
  return row.kind === "work" && row.workKind === "question";
}

function isTimelineFeedRow(row: TimelineQuestionSearchRow): row is TimelineFeedRow {
  return "key" in row;
}

function timelineRowSourceSeqStart(row: TimelineQuestionSearchRow): number {
  return isTimelineFeedRow(row) ? row.source.start : row.sourceSeqStart;
}

function timelineRowSourceSeqEnd(row: TimelineQuestionSearchRow): number {
  return isTimelineFeedRow(row) ? row.source.end : row.sourceSeqEnd;
}

async function collectQuestionRows({
  api,
  rows,
  threadId,
}: CollectQuestionRowsArgs): Promise<TimelineQuestionRow[]> {
  const questionRows: TimelineQuestionRow[] = [];
  for (const row of rows) {
    if (isQuestionWorkRow(row)) {
      questionRows.push(row);
    }
    if (row.kind === "turn" && row.children) {
      questionRows.push(
        ...(await collectQuestionRows({ api, rows: row.children, threadId })),
      );
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      questionRows.push(
        ...(await collectQuestionRows({ api, rows: row.childRows, threadId })),
      );
    }
    if (row.kind === "turn" && row.children === null && row.summaryCount > 0) {
      const detail = await getThreadTimelineTurnSummaryDetails({
        api,
        sourceSeqEnd: timelineRowSourceSeqEnd(row),
        sourceSeqStart: timelineRowSourceSeqStart(row),
        threadId,
        turnId: row.turnId,
      });
      questionRows.push(
        ...(await collectQuestionRows({ api, rows: detail.rows, threadId })),
      );
    }
    if (isTimelineFeedRow(row) && row.detail?.parts.includes("children")) {
      const detail = await getThreadTimelineRowDetail({
        api,
        detail: row.detail,
        parts: ["children"],
        threadId,
      });
      if (detail.parts.children) {
        questionRows.push(
          ...(await collectQuestionRows({
            api,
            rows: detail.parts.children,
            threadId,
          })),
        );
      }
    }
  }
  return questionRows;
}

describe.sequential("fake provider user-question integration", () => {
  it("pauses for a user question and resumes with the answer", () =>
    withHarness(
      {
        adapterFactory: (providerId) =>
          createFakeAdapter({
            displayName: providerId,
            id: providerId,
            supportsUserQuestion: true,
          }),
      },
      async (harness) => {
        const project = await createProjectFixture(
          harness,
          "User Question Smoke",
        );
        const { thread } = await createReadyThread(harness, {
          projectId: project.id,
          workspace: {
            type: "unmanaged",
            path: harness.repoDir,
          },
        });

        await sendTextMessage(harness.api, thread.id, {
          text: "ask_user",
        });
        await waitForEventType(
          harness.api,
          thread.id,
          "system/userQuestion/lifecycle",
          TURN_TIMEOUT_MS,
        );

        const interactions = await listThreadInteractions(
          harness.api,
          thread.id,
        );
        const interaction = interactions.find(isUserQuestionInteraction);
        if (!interaction) {
          throw new Error("Expected a pending user-question interaction");
        }
        expect(interaction.status).toBe("pending");

        const question = interaction.payload.questions[0];
        if (!question) {
          throw new Error("Expected a user-question payload question");
        }
        const stagingOption = question.options?.find(
          (option) => option.value === "staging",
        );
        if (!stagingOption) {
          throw new Error("Expected the fake provider staging option");
        }
        expect(question.prompt).toBe(
          "Which deployment path should the fake provider use?",
        );

        const resolution = {
          kind: "user_answer",
          answers: {
            [question.id]: {
              selected: [stagingOption.value],
              freeText: "Use staging first.",
            },
          },
        } satisfies PendingInteractionResolution;
        const resolvingInteraction = await resolveThreadInteraction({
          api: harness.api,
          threadId: thread.id,
          interactionId: interaction.id,
          resolution,
        });
        expect(resolvingInteraction.status).toBe("resolving");

        await waitForThreadStatus(
          harness.api,
          thread.id,
          "idle",
          TURN_TIMEOUT_MS,
        );

        await expect(
          listThreadInteractions(harness.api, thread.id),
        ).resolves.toEqual([]);
        await expect(
          getThreadOutput(harness.api, thread.id),
        ).resolves.toContain("Question answered: staging, Use staging first.");

        const timeline = await getThreadTimeline(harness.api, thread.id, {
          segmentLimit: 100,
        });
        const questionRows = await collectQuestionRows({
          api: harness.api,
          rows: timeline.rows,
          threadId: thread.id,
        });
        const questionRow = questionRows.find(
          (row) => row.interactionId === interaction.id,
        );
        expect(questionRow).toMatchObject({
          lifecycle: "answered",
          answers: resolution.answers,
        });
      },
    ));
});
