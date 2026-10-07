import type { BbPluginApi, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import {
  ASK_USER_QUESTION_RENDERER_ID,
  interactionResponseSchema,
  toolInputSchema,
} from "./contracts.js";
import { TOOL_DESCRIPTION, buildTimeoutMessage } from "./tool-definition.js";
import {
  assertInteractionPayloadFits,
  buildInteractionPayload,
  buildInteractionTitle,
  buildToolResult,
  describeAnswers,
  validateToolInput,
} from "./translate.js";

export const TOOL_NAME = "AskUserQuestion";

const QUESTION_TIMEOUT_OPTIONS = new Map([
  ["30 minutes", 30 * 60 * 1000],
  ["1 hour", 60 * 60 * 1000],
  ["4 hours", 4 * 60 * 60 * 1000],
  ["24 hours", 24 * 60 * 60 * 1000],
  ["7 days", 7 * 24 * 60 * 60 * 1000],
]);

function questionTimeoutMs(value: string): number {
  const timeoutMs = QUESTION_TIMEOUT_OPTIONS.get(value);
  if (timeoutMs === undefined) {
    throw new Error(`Unsupported question timeout: ${value}`);
  }
  return timeoutMs;
}

function errorResult(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    questionTimeout: {
      type: "select",
      label: "Question timeout",
      description:
        "How long a question card stays open waiting for your answer.",
      options: [...QUESTION_TIMEOUT_OPTIONS.keys()],
      default: "30 minutes",
    },
  });

  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    presentation: {
      label: { pending: "Asking a question", completed: "Asked a question" },
      icon: { glyph: "MessageQuestion" },
      suppress: true,
    },
    parameters: toolInputSchema,
    async execute(input, ctx) {
      const invalid = validateToolInput(input);
      if (invalid !== null) return errorResult(invalid);

      const payload = buildInteractionPayload(input);
      try {
        assertInteractionPayloadFits(payload);
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }

      const { questionTimeout } = await settings.get();
      const askedAt = Date.now();
      let result;
      try {
        result = await bb.ui.requestInput(
          {
            threadId: ctx.threadId,
            rendererId: ASK_USER_QUESTION_RENDERER_ID,
            title: buildInteractionTitle(payload),
            payload,
            timeoutMs: questionTimeoutMs(questionTimeout),
            presentation: {
              label: { pending: "Asking a question", completed: "Asked" },
              icon: { glyph: "MessageQuestion" },
            },
            describeSubmission: (value) => {
              const parsed = interactionResponseSchema.safeParse(value);
              if (!parsed.success) return {};
              return describeAnswers(
                payload,
                buildToolResult(payload, parsed.data),
              );
            },
          },
          { signal: ctx.signal },
        );
      } catch (error) {
        return errorResult(
          `The question could not be shown (${error instanceof Error ? error.message : String(error)}). Only one prompt can await the user at a time — put all of your questions in a single AskUserQuestion call, or continue with your best judgement.`,
        );
      }

      if (result.outcome === "cancelled") {
        return errorResult(
          result.reason === "timeout"
            ? buildTimeoutMessage(Date.now() - askedAt)
            : "The user dismissed the question without answering. Proceed with your best judgement, or ask again in your reply.",
        );
      }

      const parsed = interactionResponseSchema.safeParse(result.value);
      if (!parsed.success) {
        return errorResult(
          "The answer could not be read. Ask the question again in your reply instead.",
        );
      }
      const toolResult = buildToolResult(payload, parsed.data);
      if (Object.keys(toolResult.answers).length === 0) {
        return errorResult(
          "The user submitted no answers. Proceed with your best judgement, or ask again in your reply.",
        );
      }
      return JSON.stringify(toolResult);
    },
  });

  bb.agents.configure((context) => {
    if (context.provider.capabilities.supportsNativeUserQuestion) {
      return { tools: [], skills: [] };
    }
    return {
      tools: [TOOL_NAME],
      skills: [],
    };
  });
}
