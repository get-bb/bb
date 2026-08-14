import type { BbPluginApi, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { interactionResponseSchema, toolInputSchema } from "./contracts.js";
import {
  TOOL_DESCRIPTION,
  TOOL_INPUT_JSON_SCHEMA,
  buildTimeoutMessage,
} from "./tool-definition.js";
import {
  assertInteractionPayloadFits,
  buildInteractionPayload,
  buildInteractionTitle,
  buildToolResult,
  validateToolInput,
} from "./translate.js";

export const TOOL_NAME = "AskUserQuestion";
export const RENDERER_ID = "ask-user-question";

/**
 * Claude Code ships `AskUserQuestion` natively, and BB wires that native call
 * straight into the provider's own pending-interaction path. Registering a
 * second, plugin-owned tool of the same name for those threads would give the
 * model two ways to ask one question, so the tool is withheld there.
 */
export const NATIVE_TOOL_PROVIDER_IDS: readonly string[] = ["claude-code"];

export function providerHasNativeTool(providerId: string): boolean {
  return NATIVE_TOOL_PROVIDER_IDS.includes(providerId);
}

function errorResult(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export default function plugin(bb: BbPluginApi) {
  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
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
            rendererId: RENDERER_ID,
            title: buildInteractionTitle(payload),
            payload,
          },
          { signal: ctx.signal },
        );
      } catch (error) {
        // A thread holds at most one interaction at a time, so two questions
        // issued as parallel tool calls race and the loser lands here. Say so
        // plainly: the model can put every question in one call instead.
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
    if (providerHasNativeTool(context.provider.id)) {
      return { tools: [], skills: [] };
    }
    return {
      tools: [{ name: TOOL_NAME, parameters: TOOL_INPUT_JSON_SCHEMA }],
      skills: [],
    };
  });
}
