import {
  isExtensionKind,
  parseExtensionKind,
  type ApprovalPendingInteractionPayload,
  type ExtensionKind,
  type JsonValue,
  type PendingInteraction,
  type PendingInteractionApprovalSubject,
  type PendingInteractionUserQuestionQuestion,
} from "@bb/domain";

/**
 * The interaction split (docs/provider-plugin-api.md §4) as the client
 * renders it.
 *
 * Approvals are the closed, policy-bearing set a permission mode may decide
 * without the user: command, fileChange, toolUse, permissionGrant. Requests
 * are the open set that always reaches the user or the plugin that owns
 * them: `userQuestion` and `planReview` render with core renderers; a
 * `"<pluginId>/<kind>"` request renders with the plugin through the
 * `pendingInteraction` slot.
 *
 * Two wire shapes feed this view. A plugin's own request arrives as
 * `kind: "plugin"` with an `origin`; a provider's plugin-defined request
 * arrives with the namespaced kind directly. A plan review rides the `plan`
 * approval subject (the pinned permission matrix keeps it there) and is
 * lifted into the request family here.
 */
export type InteractionRequestView =
  | {
      family: "approval";
      payload: ApprovalPendingInteractionPayload;
      /** `payload.subject`, less the plan subject the plan review lifts out. */
      subject: Exclude<PendingInteractionApprovalSubject, { kind: "plan" }>;
    }
  | {
      family: "request";
      kind: "user_question";
      questions: readonly PendingInteractionUserQuestionQuestion[];
    }
  | {
      family: "request";
      kind: "plan_review";
      review: Extract<PendingInteractionApprovalSubject, { kind: "plan" }>;
      /**
       * The approval the review rides on: its resolution (`allow_once` /
       * `deny`) carries the verdict back.
       */
      approval: ApprovalPendingInteractionPayload;
    }
  | {
      family: "request";
      kind: ExtensionKind;
      pluginId: string;
      /** The plugin-local request name — the renderer id the plugin registered. */
      name: string;
      title: string;
      data: JsonValue;
    };

/** The parts of a pending interaction the classification reads. */
interface RequestBearingInteraction {
  payload: PendingInteraction["payload"];
  origin?: PendingInteraction["origin"];
}

export function classifyInteractionRequest(
  interaction: RequestBearingInteraction,
): InteractionRequestView {
  const { payload } = interaction;
  switch (payload.kind) {
    case "user_question":
      return {
        family: "request",
        kind: "user_question",
        questions: payload.questions,
      };
    case "plugin": {
      const origin = interaction.origin;
      if (origin === undefined || origin.kind !== "plugin") {
        throw new Error("a plugin pending interaction carries a plugin origin");
      }
      return {
        family: "request",
        kind: `${origin.pluginId}/${origin.rendererId}`,
        pluginId: origin.pluginId,
        name: origin.rendererId,
        title: payload.title,
        data: payload.data,
      };
    }
    case "approval": {
      const { subject } = payload;
      if (subject.kind === "plan") {
        return {
          family: "request",
          kind: "plan_review",
          review: subject,
          approval: payload,
        };
      }
      return { family: "approval", payload, subject };
    }
    default: {
      // The plugin member of the request family: a namespaced kind.
      if (isExtensionKind(payload.kind)) {
        const { pluginId, name } = parseExtensionKind(payload.kind);
        return {
          family: "request",
          kind: payload.kind,
          pluginId,
          name,
          title: payload.title,
          data: payload.data,
        };
      }
      throw new Error(
        `unknown interaction payload kind ${JSON.stringify(payload.kind)}`,
      );
    }
  }
}
