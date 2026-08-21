import {
  isExtensionKind,
  parseExtensionKind,
  type ApprovalPendingInteractionPayload,
  type ExtensionKind,
  type InteractionRequestPayload,
  type JsonValue,
  type PendingInteraction,
  type PendingInteractionUserQuestionQuestion,
  type PlanReviewInteractionRequestPayload,
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
 * Two wire shapes feed this view. Today's `PendingInteraction` still carries
 * a plan review as an approval subject (`kind: "plan"`) and a plugin request
 * as `kind: "plugin"` with an `origin`; the target `InteractionRequestPayload`
 * carries `plan_review` and the namespaced plugin kind directly. WS5 owns the
 * producers; this classifier renders either, so the UI is ready before the
 * wire moves and unchanged after it does.
 */
export type InteractionRequestView =
  | {
      family: "approval";
      payload: ApprovalPendingInteractionPayload;
    }
  | {
      family: "request";
      kind: "user_question";
      questions: readonly PendingInteractionUserQuestionQuestion[];
    }
  | {
      family: "request";
      kind: "plan_review";
      review: PlanReviewInteractionRequestPayload;
      /**
       * How the verdict is sent back. Today's wire resolves a plan review
       * through the approval resolution (`allow_once` / `deny`) of the
       * `plan` subject it rides on; the request family will carry its own.
       */
      resolvesAs: "approval" | "request";
      /** The approval payload when `resolvesAs` is `"approval"`. */
      approval: ApprovalPendingInteractionPayload | null;
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

/** An interaction whose payload is either wire shape. */
export interface RequestBearingInteraction {
  payload: PendingInteraction["payload"] | InteractionRequestPayload;
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
    case "plan_review":
      return {
        family: "request",
        kind: "plan_review",
        review: payload,
        resolvesAs: "request",
        approval: null,
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
    case "approval":
      if (payload.subject.kind === "plan") {
        const { itemId, plan, planFilePath } = payload.subject;
        return {
          family: "request",
          kind: "plan_review",
          review: { kind: "plan_review", itemId, plan, planFilePath },
          resolvesAs: "approval",
          approval: payload,
        };
      }
      return { family: "approval", payload };
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
