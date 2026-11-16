import { z } from "zod";

const idSchema = z.string().min(1);
const nonBlankTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "Subagent message text cannot be blank",
  });

const spawnedSchema = z
  .object({
    sessionUpdate: z.literal("subagent_spawned"),
    subagent_id: idSchema,
    parent_session_id: idSchema,
    child_session_id: idSchema,
    subagent_type: nonBlankTextSchema,
    description: nonBlankTextSchema,
    model: z.string().optional(),
  })
  .passthrough();

const progressSchema = z
  .object({
    sessionUpdate: z.literal("subagent_progress"),
    subagent_id: idSchema,
    duration_ms: z.number().nonnegative().optional(),
    turn_count: z.number().int().nonnegative().optional(),
    tool_call_count: z.number().int().nonnegative().optional(),
    tokens_used: z.number().nonnegative().optional(),
  })
  .passthrough();

const finishedSchema = z
  .object({
    sessionUpdate: z.literal("subagent_finished"),
    subagent_id: idSchema,
    status: z.enum(["completed", "cancelled", "failed"]),
    output: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type GrokSubagentNotification =
  | {
      kind: "spawned";
      subagentId: string;
      parentSessionId: string;
      childSessionId: string;
      description: string;
      subagentType: string;
      model?: string;
    }
  | {
      kind: "progress";
      subagentId: string;
      durationMs?: number;
      turnCount?: number;
      toolCallCount?: number;
      tokensUsed?: number;
    }
  | {
      kind: "finished";
      subagentId: string;
      status: "completed" | "cancelled" | "failed";
      output?: string;
      error?: string;
    };

export function decodeGrokSubagentNotification(
  update: unknown,
): GrokSubagentNotification {
  const kind = z
    .enum(["subagent_spawned", "subagent_progress", "subagent_finished"])
    .parse(
      typeof update === "object" && update !== null
        ? Reflect.get(update, "sessionUpdate")
        : undefined,
    );
  if (kind === "subagent_spawned") {
    const parsed = spawnedSchema.parse(update);
    return {
      kind: "spawned",
      subagentId: parsed.subagent_id,
      parentSessionId: parsed.parent_session_id,
      childSessionId: parsed.child_session_id,
      description: parsed.description,
      subagentType: parsed.subagent_type,
      ...(parsed.model === undefined ? {} : { model: parsed.model }),
    };
  }
  if (kind === "subagent_progress") {
    const parsed = progressSchema.parse(update);
    return {
      kind: "progress",
      subagentId: parsed.subagent_id,
      ...(parsed.duration_ms === undefined
        ? {}
        : { durationMs: parsed.duration_ms }),
      ...(parsed.turn_count === undefined
        ? {}
        : { turnCount: parsed.turn_count }),
      ...(parsed.tool_call_count === undefined
        ? {}
        : { toolCallCount: parsed.tool_call_count }),
      ...(parsed.tokens_used === undefined
        ? {}
        : { tokensUsed: parsed.tokens_used }),
    };
  }
  const parsed = finishedSchema.parse(update);
  return {
    kind: "finished",
    subagentId: parsed.subagent_id,
    status: parsed.status,
    output: parsed.output,
    error: parsed.error,
  };
}

export function decodeGrokSpawnToolResult(rawOutput: unknown): string {
  const parsed = z
    .object({ type: z.literal("Text"), text: z.string() })
    .passthrough()
    .parse(rawOutput);
  const match = /\bsubagent_id:\s*([A-Za-z0-9-]+)/.exec(parsed.text);
  if (match?.[1] === undefined) {
    throw new Error("Grok spawn result is missing subagent_id");
  }
  return match[1];
}

export type GrokSubagentActionResult =
  | { kind: "message"; messageId: string }
  | { kind: "cancel"; childRef: string };

export function decodeGrokSubagentActionResult(
  toolName: "send_subagent_message" | "kill_command_or_subagent",
  rawOutput: unknown,
): GrokSubagentActionResult {
  if (toolName === "send_subagent_message") {
    const parsed = z
      .object({
        type: z.literal("SendSubagentMessage"),
        outcome: z.literal("accepted"),
        message_id: idSchema,
      })
      .passthrough()
      .parse(rawOutput);
    return { kind: "message", messageId: parsed.message_id };
  }
  const parsed = z
    .object({
      type: z.literal("KillTask"),
      Result: z
        .object({
          task_id: idSchema,
          outcome: z.literal("killed"),
          message: z.string().optional(),
        })
        .passthrough(),
    })
    .passthrough()
    .parse(rawOutput);
  return { kind: "cancel", childRef: parsed.Result.task_id };
}

export function buildGrokSubagentActionPrompt(args: {
  kind: "tell" | "cancel";
  childRef: string;
  text?: string;
}): string {
  const childRef = idSchema.parse(args.childRef);
  if (args.kind === "cancel") {
    return `Use kill_command_or_subagent with task_ids=[${JSON.stringify(childRef)}] to cancel only that child. Do not cancel the parent session or any sibling. Return the tool result.`;
  }
  const text = nonBlankTextSchema.parse(args.text);
  return `Use send_subagent_message with subagent_id=${JSON.stringify(childRef)}, delivery="interject", and text exactly ${JSON.stringify(text)}. Send it only to that child, then return the tool result.`;
}
