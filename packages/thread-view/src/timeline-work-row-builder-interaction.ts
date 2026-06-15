import type { TimelineRowBase, TimelineSourceRow } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import type {
  TimelinePermissionGrantProjectionMessage,
  TimelineUserQuestionProjectionMessage,
} from "./timeline-work-row-builder-shared.js";

interface BuildInteractionWorkRowsArgs {
  base: TimelineRowBase;
  message:
    | TimelinePermissionGrantProjectionMessage
    | TimelineUserQuestionProjectionMessage;
}

export function buildInteractionWorkRows({
  base,
  message,
}: BuildInteractionWorkRowsArgs): TimelineSourceRow[] {
  switch (message.kind) {
    case "permission-grant-lifecycle":
      return [
        {
          ...base,
          kind: "work",
          workKind: "approval",
          status: message.status,
          interactionId: message.interactionId,
          approvalKind: "permission-grant",
          lifecycle: message.lifecycle,
          grantScope: message.grantScope,
          statusReason: message.statusReason,
          target: message.approvalTarget,
        },
      ];
    case "user-question-lifecycle":
      return [
        {
          ...base,
          kind: "work",
          workKind: "question",
          status: message.status,
          interactionId: message.interactionId,
          lifecycle: message.lifecycle,
          questions: message.questions,
          answers: message.answers,
          statusReason: message.statusReason,
        },
      ];
    default:
      return assertNever(message);
  }
}
