/**
 * Claude Code interactive-request ↔ canonical pending-interaction mapping.
 *
 * Maps the claude-code bridge's provider-filtered interactive requests
 * (permission approvals, AskUserQuestion, plan-mode exit) onto the canonical
 * `PendingInteractionPayload`/`PendingInteractionResolution` shapes from
 * `@bb/domain`, and canonical resolutions back onto the Claude interactive
 * response contract — one module for both directions of the bridge's
 * `interaction/request` path.
 */

import {
  type ApprovalPendingInteractionPayload,
  type PendingInteractionApprovalDecision,
  type PendingInteractionApprovalSubject,
  type PendingInteractionGrantedPermissionProfile,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
  type PendingInteractionUserQuestionQuestion,
  type UserQuestionPendingInteractionPayload,
  type UserQuestionPendingInteractionResolution,
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
  ProviderResponseEncodeError,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  buildClaudePlanRejectionMessage,
  buildClaudeSessionPermissionUpdates,
  CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
  claudeExitPlanModeInputSchema,
  isClaudeConcreteFileChangeToolName,
  type ClaudeInteractiveResponse,
  type ClaudePermissionRequestApprovalParams,
  type ClaudeUserQuestion,
  type ClaudeUserQuestionOutput,
  type ClaudeUserQuestionRequestParams,
} from "./interactive-contract.js";
import { claudeFileEditArgsSchema } from "./schemas.js";
import {
  getClaudeFileEditPath,
  parseClaudeBashCommand,
} from "./delta-translation.js";

function hasClaudeSessionPermissionUpdate(
  args: ClaudePermissionRequestApprovalParams,
): boolean {
  return (
    buildClaudeSessionPermissionUpdates({
      permissions: args.permissions,
      toolName: args.toolName,
    }) !== undefined
  );
}

function buildClaudeApprovalAvailableDecisions(
  args: ClaudePermissionRequestApprovalParams,
): PendingInteractionApprovalDecision[] {
  // A plan verdict is not a grant, so "allow for session" has nothing to mean.
  if (args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
    return ["allow_once", "deny"];
  }
  return hasClaudeSessionPermissionUpdate(args)
    ? ["allow_once", "allow_for_session", "deny"]
    : ["allow_once", "deny"];
}

function buildClaudeApprovalSubject(
  args: ClaudePermissionRequestApprovalParams,
): PendingInteractionApprovalSubject {
  if (args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
    const parsed = claudeExitPlanModeInputSchema.safeParse(args.input);
    if (parsed.success) {
      return {
        kind: "plan",
        itemId: args.itemId,
        plan: parsed.data.plan,
        planFilePath: parsed.data.planFilePath ?? null,
      };
    }
  }

  if (args.toolName === "Bash") {
    const bashCommand = parseClaudeBashCommand(args.input);
    if (bashCommand) {
      return {
        kind: "command",
        itemId: args.itemId,
        command: bashCommand.command,
        cwd: bashCommand.cwd,
        actions: [
          {
            type: "unknown",
            command: bashCommand.command,
          },
        ],
        sessionGrant: args.permissions,
      };
    }
  }

  if (isClaudeConcreteFileChangeToolName(args.toolName)) {
    const parsed = claudeFileEditArgsSchema.safeParse(args.input);
    if (parsed.success && getClaudeFileEditPath(parsed.data)) {
      return {
        kind: "file_change",
        itemId: args.itemId,
        writeScope: null,
        sessionGrant: args.permissions,
      };
    }
  }

  return {
    kind: "permission_grant",
    itemId: args.itemId,
    toolName: args.toolName,
    permissions: args.permissions,
  };
}

/** The canonical approval payload for a Claude permission-approval request. */
export function buildClaudeApprovalInteractionPayload(
  args: ClaudePermissionRequestApprovalParams,
): ApprovalPendingInteractionPayload {
  return {
    kind: "approval",
    subject: buildClaudeApprovalSubject(args),
    reason: args.reason,
    availableDecisions: buildClaudeApprovalAvailableDecisions(args),
  };
}

function buildClaudeUserQuestionId(
  itemId: string,
  questionIndex: number,
): string {
  return `${itemId}:question-${questionIndex + 1}`;
}

function buildClaudeUserQuestionOptionValue(
  questionId: string,
  optionIndex: number,
): string {
  return `${questionId}:option-${optionIndex + 1}`;
}

export function buildClaudeUserQuestionPayload(
  args: ClaudeUserQuestionRequestParams,
): UserQuestionPendingInteractionPayload {
  return {
    kind: "user_question",
    questions: args.questions.map((question, questionIndex) => {
      const questionId = buildClaudeUserQuestionId(args.itemId, questionIndex);
      return {
        id: questionId,
        prompt: question.question,
        shortLabel: question.header,
        multiSelect: question.multiSelect,
        options: question.options.map((option, optionIndex) => ({
          value: buildClaudeUserQuestionOptionValue(questionId, optionIndex),
          label: option.label,
          description: option.description,
        })),
        allowFreeText: true,
      };
    }),
  };
}

function buildClaudeUserQuestion(
  question: PendingInteractionUserQuestionQuestion,
): ClaudeUserQuestion {
  if (!question.options || question.options.length === 0) {
    throw new ProviderResponseEncodeError(
      `User question '${question.id}' has no options to return to Claude`,
    );
  }
  return {
    question: question.prompt,
    header: question.shortLabel ?? question.prompt.slice(0, 12),
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description ?? option.label,
    })),
    multiSelect: question.multiSelect,
  };
}

function buildClaudeUserQuestionAnswerText(
  question: PendingInteractionUserQuestionQuestion,
  resolution: UserQuestionPendingInteractionResolution,
): string {
  const answer = resolution.answers[question.id];
  if (!answer) {
    throw new ProviderResponseEncodeError(
      `Missing answer for user question '${question.id}'`,
    );
  }
  const options = question.options ?? [];
  const selectedLabels = answer.selected.map((selectedValue) => {
    const option = options.find(
      (candidate) => candidate.value === selectedValue,
    );
    if (!option) {
      throw new ProviderResponseEncodeError(
        `Unknown selected option '${selectedValue}' for user question '${question.id}'`,
      );
    }
    return option.label;
  });
  if (selectedLabels.length > 0) {
    const selectedText = selectedLabels.join(", ");
    return answer.freeText
      ? `${selectedText}; ${answer.freeText}`
      : selectedText;
  }
  if (answer.freeText) {
    return answer.freeText;
  }
  throw new ProviderResponseEncodeError(
    `Answer for user question '${question.id}' is empty`,
  );
}

function buildClaudeUserQuestionAnnotations(
  payload: UserQuestionPendingInteractionPayload,
  resolution: UserQuestionPendingInteractionResolution,
): ClaudeUserQuestionOutput["annotations"] {
  const annotations: NonNullable<ClaudeUserQuestionOutput["annotations"]> = {};
  for (const question of payload.questions) {
    const answer = resolution.answers[question.id];
    if (answer && answer.selected.length > 0 && answer.freeText !== undefined) {
      annotations[question.prompt] = { notes: answer.freeText };
    }
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

function validateUniqueClaudeUserQuestionPrompts(
  payload: UserQuestionPendingInteractionPayload,
): void {
  const prompts = new Set<string>();
  for (const question of payload.questions) {
    if (prompts.has(question.prompt)) {
      throw new ProviderResponseEncodeError(
        `Claude user-question prompts must be unique; duplicate prompt '${question.prompt}'`,
      );
    }
    prompts.add(question.prompt);
  }
}

function buildClaudeUserQuestionOutput(
  payload: UserQuestionPendingInteractionPayload,
  resolution: UserQuestionPendingInteractionResolution,
): ClaudeUserQuestionOutput {
  validateUniqueClaudeUserQuestionPrompts(payload);
  const answers: ClaudeUserQuestionOutput["answers"] = {};
  for (const question of payload.questions) {
    answers[question.prompt] = buildClaudeUserQuestionAnswerText(
      question,
      resolution,
    );
  }
  const annotations = buildClaudeUserQuestionAnnotations(payload, resolution);
  return {
    questions: payload.questions.map(buildClaudeUserQuestion),
    answers,
    ...(annotations ? { annotations } : {}),
  };
}

function resolveClaudeGrantedPermissions(
  grantedPermissions: PendingInteractionGrantedPermissionProfile | null,
): PendingInteractionGrantedPermissionProfile {
  if (grantedPermissions === null) {
    throw new ProviderResponseEncodeError(
      "Session approval resolution must include granted permissions",
    );
  }

  return grantedPermissions;
}

function getClaudePermissionUpdateToolName(
  payload: ApprovalPendingInteractionPayload,
): string | null {
  switch (payload.subject.kind) {
    case "command":
      return "Bash";
    case "file_change":
      return null;
    case "permission_grant":
      return payload.subject.toolName;
    // A plan verdict grants nothing, so it never reaches a session update.
    case "plan":
      return null;
  }
}

/**
 * Map a canonical resolution back onto the Claude interactive response the
 * request payload calls for. Throws `ProviderResponseEncodeError` when the
 * resolution kind does not match the payload — the adapter surfaces that as
 * an encode error, the bridge as a denied request.
 */
export function buildClaudeInteractiveResponse(args: {
  payload: PendingInteractionPayload;
  resolution: PendingInteractionResolution;
}): ClaudeInteractiveResponse {
  if (
    isUserQuestionPendingInteractionPayload(args.payload) &&
    isUserQuestionPendingInteractionResolution(args.resolution)
  ) {
    return {
      kind: "user_question",
      behavior: "allow",
      updatedInput: buildClaudeUserQuestionOutput(
        args.payload,
        args.resolution,
      ),
    };
  }

  if (
    !isApprovalPendingInteractionPayload(args.payload) ||
    !isApprovalPendingInteractionResolution(args.resolution)
  ) {
    throw new ProviderResponseEncodeError(
      "Claude Code interactive response kind does not match the request payload",
    );
  }

  if (args.resolution.decision === "deny") {
    return {
      kind: "permission_request",
      behavior: "deny",
      message:
        args.payload.subject.kind === "plan"
          ? buildClaudePlanRejectionMessage()
          : "Permission request denied",
      decisionClassification: "user_reject",
    };
  }

  if (args.resolution.decision === "allow_once") {
    // Claude canUseTool approvals without updatedPermissions apply only
    // to the current tool request. Session grants are the only scope
    // that should mutate Claude's permission state.
    return {
      kind: "permission_request",
      behavior: "allow",
      decisionClassification: "user_temporary",
    };
  }

  const updatedPermissions = buildClaudeSessionPermissionUpdates({
    permissions: resolveClaudeGrantedPermissions(
      args.resolution.grantedPermissions,
    ),
    toolName: getClaudePermissionUpdateToolName(args.payload),
  });

  return {
    kind: "permission_request",
    behavior: "allow",
    decisionClassification: "user_permanent",
    ...(updatedPermissions === undefined ? {} : { updatedPermissions }),
  };
}
