import {
  isUserQuestionPendingInteractionResolution,
  type PendingInteractionPayload,
  type PendingInteractionResolution,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

/**
 * Pi's `extension_ui_request` lines (RPC mode): the dialogs an extension
 * raises through `ctx.ui.select/confirm/input/editor`, which pi answers from
 * a matching `extension_ui_response`, and the fire-and-forget state
 * methods, which need no answer. Anything pi adds later is unknown here and
 * is cancelled (a dialog) or ignored (state), never guessed at.
 */
export const piExtensionUiRequestSchema = z.discriminatedUnion("method", [
  z
    .object({
      id: z.string().min(1),
      method: z.literal("select"),
      title: z.string(),
      options: z.array(z.string()),
      timeout: z.number().optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("confirm"),
      title: z.string(),
      message: z.string(),
      timeout: z.number().optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("input"),
      title: z.string(),
      placeholder: z.string().optional(),
      timeout: z.number().optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("editor"),
      title: z.string(),
      prefill: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("notify"),
      message: z.string(),
      notifyType: z.enum(["info", "warning", "error"]).optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("setStatus"),
      statusKey: z.string(),
      statusText: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("setWidget"),
      widgetKey: z.string(),
      widgetLines: z.array(z.unknown()).optional(),
      widgetPlacement: z.enum(["aboveEditor", "belowEditor"]).optional(),
    })
    .passthrough(),
  z
    .object({ id: z.string().min(1), method: z.literal("setTitle"), title: z.string() })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      method: z.literal("set_editor_text"),
      text: z.string(),
    })
    .passthrough(),
]);

export type PiExtensionUiRequest = z.infer<typeof piExtensionUiRequestSchema>;
export type PiExtensionDialogRequest = Extract<
  PiExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

/** The answer pi reads for a dialog (rpc-types `RpcExtensionUIResponse`). */
export type PiExtensionUiResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

export interface PiExtensionDialog {
  /** The canonical user question bb asks on the extension's behalf. */
  payload: PendingInteractionPayload;
  /** The answer pi receives for bb's resolution. */
  toResponse(resolution: PendingInteractionResolution): PiExtensionUiResponse;
}

function questionPrompt(title: string, message?: string): string {
  const combined = message === undefined ? title : `${title}\n\n${message}`;
  return combined.trim().length > 0 ? combined : "Input requested";
}

function answerOf(
  resolution: PendingInteractionResolution,
  questionId: string,
): { selected: readonly string[]; verbatim: string | undefined } | null {
  if (!isUserQuestionPendingInteractionResolution(resolution)) {
    return null;
  }
  const answer = resolution.answers[questionId];
  if (answer === undefined) {
    return null;
  }
  return {
    selected: answer.selected,
    verbatim: answer.experimental_verbatimText,
  };
}

/**
 * Every dialog is one canonical user question, thread-scoped (an extension
 * may ask outside any turn). Select options get stable ids and map back to
 * pi's exact option string; confirm is an explicit yes/no; input and editor
 * keep the submitted text verbatim, leading whitespace and newlines
 * included. A dismissed question is pi's "cancelled" — the value pi's own
 * TUI returns when the user escapes the dialog.
 */
export function buildPiExtensionDialog(
  request: PiExtensionDialogRequest,
  questionId: string,
): PiExtensionDialog {
  const id = request.id;
  switch (request.method) {
    case "select": {
      const optionByValue = new Map<string, string>(
        request.options.map((option, index) => [`option-${index}`, option]),
      );
      return {
        payload: {
          kind: "user_question",
          questions: [
            {
              id: questionId,
              prompt: questionPrompt(request.title),
              multiSelect: false,
              options: [...optionByValue].map(([value, option]) => ({
                value,
                label: option.trim().length > 0 ? option : '""',
              })),
              allowFreeText: false,
            },
          ],
        },
        toResponse(resolution) {
          const selected = answerOf(resolution, questionId)?.selected[0];
          const option = selected === undefined ? undefined : optionByValue.get(selected);
          return option === undefined ? { id, cancelled: true } : { id, value: option };
        },
      };
    }
    case "confirm":
      return {
        payload: {
          kind: "user_question",
          questions: [
            {
              id: questionId,
              prompt: questionPrompt(request.title, request.message),
              multiSelect: false,
              options: [
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ],
              allowFreeText: false,
            },
          ],
        },
        toResponse(resolution) {
          const selected = answerOf(resolution, questionId)?.selected[0];
          return selected === undefined
            ? { id, cancelled: true }
            : { id, confirmed: selected === "yes" };
        },
      };
    case "input":
      return {
        payload: {
          kind: "user_question",
          questions: [
            {
              id: questionId,
              prompt: questionPrompt(request.title),
              multiSelect: false,
              allowFreeText: true,
              experimental_responseMode: "verbatim",
              ...(request.placeholder !== undefined
                ? { experimental_placeholder: request.placeholder }
                : {}),
            },
          ],
        },
        toResponse(resolution) {
          const verbatim = answerOf(resolution, questionId)?.verbatim;
          return verbatim === undefined ? { id, cancelled: true } : { id, value: verbatim };
        },
      };
    case "editor":
      return {
        payload: {
          kind: "user_question",
          questions: [
            {
              id: questionId,
              prompt: questionPrompt(request.title),
              multiSelect: false,
              allowFreeText: true,
              experimental_responseMode: "verbatim",
              // Never shortened here: a prefill past bb's cap is cancelled
              // by the bridge before it becomes a question.
              ...(request.prefill === undefined ? {} : { experimental_prefill: request.prefill }),
            },
          ],
        },
        toResponse(resolution) {
          const verbatim = answerOf(resolution, questionId)?.verbatim;
          return verbatim === undefined ? { id, cancelled: true } : { id, value: verbatim };
        },
      };
  }
}

export function isPiExtensionDialogRequest(
  request: PiExtensionUiRequest,
): request is PiExtensionDialogRequest {
  return (
    request.method === "select" ||
    request.method === "confirm" ||
    request.method === "input" ||
    request.method === "editor"
  );
}
