import type { BbPluginApi, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import {
  ASK_USER_QUESTION_RENDERER_ID,
  interactionResponseSchema,
  toolInputSchema,
  type InteractionPayload,
} from "./contracts.js";
import {
  DISMISSED_MESSAGE,
  NO_ANSWERS_MESSAGE,
  QUESTION_POSTED_MESSAGE,
  TOOL_DESCRIPTION,
  UNREADABLE_ANSWER_MESSAGE,
  buildTimeoutMessage,
  buildUnavailableMessage,
} from "./tool-definition.js";
import {
  assertInteractionPayloadFits,
  buildAnswerMessage,
  buildInteractionPayload,
  buildInteractionTitle,
  buildToolResult,
  validateToolInput,
} from "./translate.js";

export const TOOL_NAME = "AskUserQuestion";

const QUESTION_TIMEOUT_MS = 30 * 60 * 1000;

type InteractionResult = Awaited<ReturnType<BbPluginApi["ui"]["requestInput"]>>;

function errorResult(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settledRejection(
  pending: Promise<unknown>,
): Promise<{ error: unknown } | null> {
  let rejection: { error: unknown } | null = null;
  pending.catch((error: unknown) => {
    rejection = { error };
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  return rejection;
}

export default function plugin(bb: BbPluginApi) {
  async function deliverAnswer(threadId: string, text: string): Promise<void> {
    try {
      await bb.sdk.threads.send({
        threadId,
        mode: "steer-if-active",
        input: [{ type: "text", text, mentions: [] }],
      });
    } catch (error) {
      bb.log.warn(
        `Could not deliver a question answer to thread ${threadId}: ${describeError(error)}`,
      );
    }
  }

  async function reportNonAnswerToRunningTurn(
    threadId: string,
    text: string,
  ): Promise<void> {
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.status !== "active") return;
      await bb.sdk.threads.send({
        threadId,
        mode: "steer",
        input: [{ type: "text", text, mentions: [] }],
      });
    } catch (error) {
      bb.log.warn(
        `Could not tell thread ${threadId} its question went unanswered: ${describeError(error)}`,
      );
    }
  }

  async function deliverOutcome(args: {
    askedAt: number;
    payload: InteractionPayload;
    result: InteractionResult;
    threadId: string;
  }): Promise<void> {
    const { result, threadId } = args;
    if (result.outcome === "cancelled") {
      if (result.reason === "timeout") {
        await reportNonAnswerToRunningTurn(
          threadId,
          buildTimeoutMessage(Date.now() - args.askedAt),
        );
      } else if (result.reason === "user") {
        await reportNonAnswerToRunningTurn(threadId, DISMISSED_MESSAGE);
      }
      return;
    }
    const parsed = interactionResponseSchema.safeParse(result.value);
    if (!parsed.success) {
      await reportNonAnswerToRunningTurn(threadId, UNREADABLE_ANSWER_MESSAGE);
      return;
    }
    const toolResult = buildToolResult(args.payload, parsed.data);
    if (Object.keys(toolResult.answers).length === 0) {
      await reportNonAnswerToRunningTurn(threadId, NO_ANSWERS_MESSAGE);
      return;
    }
    await deliverAnswer(threadId, buildAnswerMessage(toolResult));
  }

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
        return errorResult(describeError(error));
      }

      const askedAt = Date.now();
      const threadId = ctx.threadId;
      const pending = bb.ui.requestInput({
        threadId,
        rendererId: ASK_USER_QUESTION_RENDERER_ID,
        title: buildInteractionTitle(payload),
        payload,
        timeoutMs: QUESTION_TIMEOUT_MS,
      });

      const rejection = await settledRejection(pending);
      if (rejection !== null) {
        return errorResult(
          buildUnavailableMessage(describeError(rejection.error)),
        );
      }

      void pending.then(
        (result) => deliverOutcome({ askedAt, payload, result, threadId }),
        (error: unknown) =>
          reportNonAnswerToRunningTurn(
            threadId,
            buildUnavailableMessage(describeError(error)),
          ),
      );

      return QUESTION_POSTED_MESSAGE;
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
