import { z } from "zod";
import {
  nextStepInputSchema,
  type DynamicTool,
  type ToolCallResponse,
} from "@bb/domain";
import type { WorkSessionDeps } from "../../types.js";
import { proposeNextStep } from "./next-step.js";

export const PROPOSE_NEXT_STEP_TOOL: DynamicTool = {
  name: "propose_next_step",
  description:
    "Propose one grounded next step under this turn. Nothing starts without acceptance. Cite resolvable evidence from this thread or repository. Task starts a child thread; automation starts work now and delivers its result next weekday at 09:00 in the proposed timezone. Do not restate the proposal in prose. Abstain when unsure.",
  inputSchema: z.toJSONSchema(nextStepInputSchema),
  presentation: {
    label: {
      pending: "Checking the next step",
      completed: "Proposed next step",
    },
    icon: { glyph: "ArrowRight" },
  },
};

export async function handleProposeNextStepToolCall(
  deps: WorkSessionDeps,
  args: { threadId: string; turnId: string; input: unknown },
): Promise<ToolCallResponse> {
  try {
    const input = nextStepInputSchema.parse(args.input);
    await proposeNextStep(deps, { ...args, input });
    return {
      success: true,
      contentItems: [
        {
          type: "inputText",
          text: "shown: The Next step will appear after this successful turn when eligible. Do not repeat it in your reply.",
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text:
            error instanceof Error
              ? error.message
              : "The next step could not be verified.",
        },
      ],
    };
  }
}
