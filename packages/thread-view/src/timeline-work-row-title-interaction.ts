import { assertNever } from "./assert-never.js";
import {
  filterNull,
  makeTitle,
  segment,
  statusDecoration,
} from "./timeline-title-helpers.js";
import type { TimelineTitle } from "./timeline-row-title.js";
import type {
  TimelineQuestionViewWorkRow,
  TimelineViewWorkRow,
} from "./timeline-view.js";

type TimelineApprovalWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "approval" }
>;
type TimelineFileEditApprovalWorkRow = Extract<
  TimelineApprovalWorkRow,
  { approvalKind: "file-edit" }
>;
type TimelinePermissionGrantApprovalWorkRow = Extract<
  TimelineApprovalWorkRow,
  { approvalKind: "permission-grant" }
>;
type TimelineQuestion = TimelineQuestionViewWorkRow["questions"][number];

function mapFileEditApprovalTitle(
  row: TimelineFileEditApprovalWorkRow,
): TimelineTitle {
  switch (row.lifecycle) {
    case "waiting":
      return makeTitle({
        segments: [
          segment("Waiting for approval to edit", { shimmer: true }),
          segment("files", { em: true, truncate: true }),
        ],
      });
    case "denied":
      return makeTitle({
        segments: [
          segment("Permission denied:"),
          segment("file changes", { em: true, truncate: true }),
        ],
      });
    default:
      return assertNever(row.lifecycle);
  }
}

function mapPermissionGrantApprovalTitle(
  row: TimelinePermissionGrantApprovalWorkRow,
): TimelineTitle {
  const toolName = row.target.toolName;
  const reason =
    row.statusReason !== null && row.statusReason.trim().length > 0
      ? row.statusReason.trim()
      : null;
  const reasonSegment =
    reason !== null ? segment(`(${reason})`, { truncate: true }) : null;
  switch (row.lifecycle) {
    case "pending": {
      const segments =
        toolName !== null
          ? [
              segment("Waiting for permission", { shimmer: true }),
              segment("to use"),
              segment(toolName, { em: true, truncate: true }),
            ]
          : [segment("Waiting for permissions", { shimmer: true })];
      return makeTitle({
        segments,
      });
    }
    case "resolving": {
      const segments =
        toolName !== null
          ? [
              segment("Delivering permission", { shimmer: true }),
              segment("to use"),
              segment(toolName, { em: true, truncate: true }),
            ]
          : [segment("Delivering permissions", { shimmer: true })];
      return makeTitle({
        segments,
      });
    }
    case "granted": {
      const scopeText =
        row.grantScope === "turn"
          ? "for this turn"
          : row.grantScope === "session"
            ? "for this session"
            : null;
      const prefix =
        scopeText !== null
          ? `Permission granted ${scopeText}:`
          : "Permission granted:";
      const segments =
        toolName !== null
          ? [segment(prefix), segment(toolName, { em: true, truncate: true })]
          : [
              segment(
                scopeText !== null
                  ? `Permission granted ${scopeText}`
                  : "Permission granted",
              ),
            ];
      return makeTitle({
        segments,
      });
    }
    case "denied":
      return makeTitle({
        segments:
          toolName !== null
            ? [
                segment("Permission denied:"),
                segment(toolName, { em: true, truncate: true }),
              ]
            : [segment("Permission denied")],
      });
    case "interrupted":
      return makeTitle({
        segments: filterNull([
          toolName !== null
            ? segment("Permission grant interrupted:")
            : segment("Permission grant interrupted"),
          toolName !== null
            ? segment(toolName, { em: true, truncate: true })
            : null,
          reasonSegment,
        ]),
      });
    default:
      return assertNever(row.lifecycle);
  }
}

export function mapApprovalTitle(row: TimelineApprovalWorkRow): TimelineTitle {
  switch (row.approvalKind) {
    case "file-edit":
      return mapFileEditApprovalTitle(row);
    case "permission-grant":
      return mapPermissionGrantApprovalTitle(row);
    default:
      return assertNever(row);
  }
}

function singleQuestion(row: TimelineQuestionViewWorkRow): TimelineQuestion | null {
  return row.questions.length === 1 ? (row.questions[0] ?? null) : null;
}

/**
 * Selected option labels (plus any free text) for an answered single question,
 * so the title can read "Answered <prompt> — <answer>". Null when there's no
 * recorded answer.
 */
function singleQuestionAnswerSummary(
  row: TimelineQuestionViewWorkRow,
  question: TimelineQuestion,
): string | null {
  const answer = row.answers?.[question.id];
  if (!answer) {
    return null;
  }
  const parts = answer.selected.map((value) => {
    const option = question.options?.find(
      (candidate) => candidate.value === value,
    );
    return option?.label ?? value;
  });
  if (answer.freeText) {
    parts.push(answer.freeText);
  }
  const text = parts.join(", ");
  return text.length > 0 ? text : null;
}

export function mapQuestionTitle(
  row: TimelineQuestionViewWorkRow,
): TimelineTitle {
  const question = singleQuestion(row);
  // Single question → surface the prompt (and answer once given). Multiple →
  // a per-prompt title would only show the first and read as if it were the
  // whole interaction, so summarize the count instead.
  const subject = question
    ? segment(question.prompt, { em: true, truncate: true })
    : segment(`${row.questions.length} questions`, { em: true });

  switch (row.lifecycle) {
    case "pending":
      return makeTitle({
        segments: [
          segment(question ? "Waiting for answer" : "Waiting for answers to", {
            shimmer: true,
          }),
          subject,
        ],
      });
    case "resolving":
      return makeTitle({
        segments: [
          segment(question ? "Delivering answer" : "Delivering answers to", {
            shimmer: true,
          }),
          subject,
        ],
      });
    case "answered": {
      const answerSummary = question
        ? singleQuestionAnswerSummary(row, question)
        : null;
      return makeTitle({
        segments: filterNull([
          segment("Answered"),
          subject,
          answerSummary ? segment(`— ${answerSummary}`, { truncate: true }) : null,
        ]),
      });
    }
    case "interrupted":
      // Mirror the command/tool/web-search interrupted pattern: a past-tense
      // verb plus a status decoration. Keeps the title shape consistent with
      // peer rows; the longer statusReason lives on the row itself if a
      // reader wants the detail.
      return makeTitle({
        segments: [segment("Asked"), subject],
        decorations: [statusDecoration("interrupted", null)],
      });
    default:
      return assertNever(row.lifecycle);
  }
}
