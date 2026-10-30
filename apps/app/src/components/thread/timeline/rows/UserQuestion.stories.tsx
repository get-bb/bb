import type { TimelineRow } from "@bb/server-contract";
import {
  ThreadTimelineRows,
  type ThreadTimelineRowsProps,
} from "@/components/thread/timeline";
import { questionRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/User Question",
};

interface TimelineStageProps {
  children: React.ReactNode;
}

type TimelineQuestionRow = Extract<TimelineRow, { workKind: "question" }>;
type TimelineRowsBaseProps = Omit<ThreadTimelineRowsProps, "timelineRows">;

function TimelineStage({ children }: TimelineStageProps) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

const baseProps: TimelineRowsBaseProps = {
  threadRuntimeDisplayStatus: "idle",
  workspaceRootPath: undefined,
};

const questions: TimelineQuestionRow["questions"] = [
  {
    id: "scope",
    prompt: "Which areas should I update?",
    shortLabel: "Scope",
    multiSelect: true,
    options: [
      { value: "app", label: "App UI" },
      { value: "cli", label: "CLI" },
      { value: "tests", label: "Tests" },
    ],
    allowFreeText: false,
    required: true,
  },
  {
    id: "notes",
    prompt: "Anything else I should account for?",
    shortLabel: "Notes",
    multiSelect: false,
    allowFreeText: true,
    required: true,
  },
];

const questionBaseArgs = {
  threadId: "thr_question_story",
  turnId: "turn_question_story",
  sourceSeqStart: 10,
  sourceSeqEnd: 10,
  startedAt: 1777340000000,
  createdAt: 1777340000000,
  interactionId: "pi_question_story",
  questions,
};

const pendingQuestion = questionRow({
  ...questionBaseArgs,
  id: "thr_question_story:question:pending",
  lifecycle: "pending",
  status: "pending",
});

const resolvingQuestion = questionRow({
  ...questionBaseArgs,
  id: "thr_question_story:question:resolving",
  lifecycle: "resolving",
  status: "pending",
  answers: {
    scope: {
      selected: ["app", "tests"],
    },
    notes: {
      selected: [],
      freeText: "Keep the banner as the actionable surface.",
    },
  },
});

const answeredQuestion = questionRow({
  ...questionBaseArgs,
  id: "thr_question_story:question:answered",
  lifecycle: "answered",
  status: "completed",
  answers: {
    scope: {
      selected: ["app", "tests"],
    },
    notes: {
      selected: [],
      freeText: "Keep the banner as the actionable surface.",
    },
  },
});

const interruptedQuestion = questionRow({
  ...questionBaseArgs,
  id: "thr_question_story:question:interrupted",
  lifecycle: "interrupted",
  status: "interrupted",
  statusReason: "The turn was interrupted before the question was answered.",
});

const interruptedSessionQuestion = questionRow({
  ...questionBaseArgs,
  id: "thr_question_story:question:interrupted-session",
  lifecycle: "interrupted",
  status: "interrupted",
  statusReason:
    "Host daemon session expired while awaiting user interaction; retry the thread to continue",
});

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="pending"
        hint="status row only; the answer controls live in the pending banner"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[pendingQuestion]}
            initialExpanded={new Set([pendingQuestion.id])}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="resolving"
        hint="answer submitted; waiting for provider acknowledgement"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[resolvingQuestion]}
            initialExpanded={new Set([resolvingQuestion.id])}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="answered" hint="shows the recorded user response">
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[answeredQuestion]}
            initialExpanded={new Set([answeredQuestion.id])}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="interrupted" hint="turn stopped before answer delivery">
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[interruptedQuestion]}
            initialExpanded={new Set([interruptedQuestion.id])}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="interrupted session"
        hint="question interrupted before answer"
      >
        <TimelineStage>
          <ThreadTimelineRows
            {...baseProps}
            timelineRows={[interruptedSessionQuestion]}
            initialExpanded={new Set([interruptedSessionQuestion.id])}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}
