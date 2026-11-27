import { z } from "zod";

const promptIndexSchema = z.number().int().nonnegative().safe();
const promptIndexCheckpointSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .refine((value) => Number.isSafeInteger(Number(value)));

const grokRewindPointSchema = z
  .object({
    prompt_index: promptIndexSchema,
    created_at: z.string().min(1),
    num_file_snapshots: z.number().int().nonnegative(),
    prompt_preview: z.string(),
    has_file_changes: z.boolean(),
  })
  .passthrough();

const grokRewindPointsResultSchema = z
  .object({ rewind_points: z.array(grokRewindPointSchema) })
  .passthrough();

const grokRewindExecuteResultSchema = z
  .object({
    success: z.boolean(),
    target_prompt_index: promptIndexSchema,
    mode: z.enum(["all", "conversation_only", "files_only", "code_only"]),
    reverted_files: z.array(z.string()),
    clean_files: z.array(z.string()),
    conflicts: z.array(z.unknown()),
    prompt_text: z.string(),
    error: z.string().nullable(),
  })
  .passthrough();

export type GrokRewindPoint = z.infer<typeof grokRewindPointSchema>;
export type GrokRewindExecuteResult = z.infer<
  typeof grokRewindExecuteResultSchema
>;

function checkpointIndex(checkpointId: string): number {
  const parsed = promptIndexCheckpointSchema.safeParse(checkpointId);
  if (!parsed.success) {
    throw new Error(`Invalid Grok rewind checkpoint ID: ${checkpointId}`);
  }
  return Number(checkpointId);
}

export function decodeGrokRewindPoints(value: unknown): GrokRewindPoint[] {
  const points = grokRewindPointsResultSchema.parse(value).rewind_points;
  const indices = new Set<number>();
  for (const point of points) {
    if (indices.has(point.prompt_index)) {
      throw new Error(
        `Grok rewind returned duplicate prompt index ${point.prompt_index}`,
      );
    }
    indices.add(point.prompt_index);
  }
  return points;
}

export function selectGrokRewindPoint(
  points: readonly GrokRewindPoint[],
  checkpointId: string,
): GrokRewindPoint {
  const promptIndex = checkpointIndex(checkpointId);
  const point = points.find((entry) => entry.prompt_index === promptIndex);
  if (point === undefined) {
    throw new Error(`Grok rewind checkpoint ${checkpointId} was not found`);
  }
  return point;
}

export function buildGrokRewindExecuteParams(params: {
  sessionId: string;
  checkpointId: string;
}): {
  sessionId: string;
  targetPromptIndex: number;
  mode: "conversation_only";
  force: true;
} {
  return {
    sessionId: params.sessionId,
    targetPromptIndex: checkpointIndex(params.checkpointId),
    mode: "conversation_only",
    force: true,
  };
}

export function selectGrokTurnCheckpointId(
  points: readonly GrokRewindPoint[],
  completedPromptIndex: number,
): string | undefined {
  if (!Number.isSafeInteger(completedPromptIndex) || completedPromptIndex < 0) {
    return undefined;
  }
  const boundaryIndex = completedPromptIndex + 1;
  const boundary = points.find((point) => point.prompt_index === boundaryIndex);
  return boundary === undefined ? undefined : String(boundary.prompt_index);
}

export function decodeGrokRewindExecuteResult(
  value: unknown,
): GrokRewindExecuteResult {
  return grokRewindExecuteResultSchema.parse(value);
}

export function assertGrokRewindExecuted(
  result: GrokRewindExecuteResult,
  checkpointId: string,
): void {
  const promptIndex = checkpointIndex(checkpointId);
  if (!result.success) {
    throw new Error(result.error ?? "Grok rewind failed");
  }
  if (result.error !== null) {
    throw new Error(`Grok rewind failed: ${result.error}`);
  }
  if (result.conflicts.length > 0) {
    throw new Error("Grok rewind failed with file conflicts");
  }
  if (result.target_prompt_index !== promptIndex) {
    throw new Error(
      `Grok rewind returned stale target ${result.target_prompt_index}; expected ${promptIndex}`,
    );
  }
  if (result.mode !== "conversation_only") {
    throw new Error(`Grok rewind returned unexpected mode ${result.mode}`);
  }
  if (result.reverted_files.length > 0) {
    throw new Error(
      "Grok rewind reverted files during a conversation-only fork",
    );
  }
}
