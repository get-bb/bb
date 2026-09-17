import type { BbPluginApi, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { toolInputSchema } from "./contracts.js";
import { TOOL_DESCRIPTION, buildTimeoutMessage } from "./tool-definition.js";
import {
  assertInteractionPayloadFits,
  buildInteractionPayload,
  buildToolResult,
  validateToolInput,
} from "./translate.js";

export const TOOL_NAME = "AskUserQuestion";

const QUESTION_TIMEOUT_MS = 30 * 60 * 1000;

function errorResult(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export default function plugin(bb: BbPluginApi) {
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

      const askedAt = Date.now();
      let result;
      try {
        result = await bb.ui.requestInput(
          {
            threadId: ctx.threadId,
            kind: "user_question",
            questions: payload.questions,
            timeoutMs: QUESTION_TIMEOUT_MS,
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

      const toolResult = buildToolResult(payload, { answers: result.value });
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
