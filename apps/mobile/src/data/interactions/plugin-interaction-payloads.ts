import type { JsonValue, PluginPendingInteraction } from "@bb/domain";
import {
  ASK_USER_QUESTION_RENDERER_ID,
  SECRET_REQUEST_RENDERER_ID,
  interactionPayloadSchema as askUserQuestionPayloadSchema,
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
  type SecretRequestPayload,
  type SecretRequestResponse,
} from "@bb/plugin-interaction-contracts";
import {
  normalizeAskUserQuestions,
  type InteractionFormQuestion,
} from "./question-form-state";

/**
 * What the native banner can do with a plugin pending interaction. The web
 * mounts the plugin's own React DOM form; the phone cannot, so the two
 * bundled plugins with a shared payload contract get native forms and every
 * other renderer falls back to a "needs the desktop app" card with Cancel.
 */
export type PluginInteractionForm =
  | {
      kind: "ask-user-question";
      questions: InteractionFormQuestion[];
    }
  | { kind: "secret-request"; payload: SecretRequestPayload }
  | {
      /** A known renderer whose payload failed its schema: only Cancel helps. */
      kind: "invalid";
      rendererId: string;
    }
  | {
      /** A renderer the phone has no native form for. */
      kind: "unsupported";
      pluginId: string;
      rendererId: string;
    };

export function parsePluginInteractionForm(
  interaction: Pick<PluginPendingInteraction, "origin" | "payload">,
): PluginInteractionForm {
  const { pluginId, rendererId } = interaction.origin;
  const data: JsonValue = interaction.payload.data;
  switch (rendererId) {
    case ASK_USER_QUESTION_RENDERER_ID: {
      const parsed = askUserQuestionPayloadSchema.safeParse(data);
      return parsed.success
        ? {
            kind: "ask-user-question",
            questions: normalizeAskUserQuestions(parsed.data.questions),
          }
        : { kind: "invalid", rendererId };
    }
    case SECRET_REQUEST_RENDERER_ID: {
      const parsed = secretRequestPayloadSchema.safeParse(data);
      return parsed.success
        ? { kind: "secret-request", payload: parsed.data }
        : { kind: "invalid", rendererId };
    }
    default:
      return { kind: "unsupported", pluginId, rendererId };
  }
}

export type SecretRequestFormResult =
  | { ok: true; response: SecretRequestResponse }
  | { ok: false; message: string };

export const SECRET_REQUEST_INVALID_VALUES_MESSAGE =
  "Every secret must be a non-empty single-line value no larger than 16 KiB.";

/**
 * Validates the typed values against the plugin's response contract and
 * checks that every requested field was filled (the plugin rejects a
 * response that does not contain exactly the requested names).
 */
export function buildSecretRequestResponse(
  payload: SecretRequestPayload,
  values: Readonly<Record<string, string>>,
): SecretRequestFormResult {
  const requested: Record<string, string> = {};
  for (const field of payload.fields) {
    requested[field.name] = values[field.name] ?? "";
  }
  const validated = secretRequestResponseSchema.safeParse({
    values: requested,
  });
  if (!validated.success) {
    return { ok: false, message: SECRET_REQUEST_INVALID_VALUES_MESSAGE };
  }
  return { ok: true, response: validated.data };
}
