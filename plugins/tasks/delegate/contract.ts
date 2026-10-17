import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "../shared/contract";

const threadIdSchema = z.string().startsWith("thr_");

export const delegationRpcContract = defineRpcContract({
  delegate: {
    invalidates: (input) => [
      `threads:${input.taskId}`,
      `prs:${input.taskId}`,
      `task:${input.taskId}`,
      `comments:${input.taskId}`,
      "active-membership",
      "sidebar",
    ],
    input: z
      .object({
        taskId: idSchema,
        presetId: idSchema,
        extraInstructions: z.string().optional(),
      })
      .strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  taskThreadsAttach: {
    invalidates: (input) => [
      `threads:${input.taskId}`,
      `prs:${input.taskId}`,
      `task:${input.taskId}`,
      `comments:${input.taskId}`,
      "active-membership",
      "sidebar",
    ],
    input: z.object({ taskId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  taskThreadsDetach: {
    invalidates: (input) => [
      `threads:${input.taskId}`,
      `prs:${input.taskId}`,
      `task:${input.taskId}`,
      `comments:${input.taskId}`,
      "active-membership",
      "sidebar",
    ],
    input: z.object({ taskId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
});

export type DelegationRpcContract = typeof delegationRpcContract;
