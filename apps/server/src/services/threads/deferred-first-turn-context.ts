import { getLastStoredTurnRequestEvent } from "@bb/db";
import type { DbQueryConnection } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import { ApiError } from "../../errors.js";
import { parseStoredTurnRequestEvent } from "./thread-events.js";

export interface DeferredFirstTurnContext {
  input: PromptInput[];
  requestSequence: number;
}

interface PromptWithGroups {
  input: PromptInput[];
  inputGroups?: PromptInput[][];
}

interface GroupedPrompt {
  input: PromptInput[];
  inputGroups: PromptInput[][];
}

function isDeferredFirstTurnContextInput(
  input: readonly PromptInput[],
): boolean {
  return (
    input.length > 0 && input.every((item) => item.visibility === "agent-only")
  );
}

export function resolveDeferredFirstTurnContext(
  db: DbQueryConnection,
  threadId: string,
): DeferredFirstTurnContext | null {
  const row = getLastStoredTurnRequestEvent(db, threadId);
  if (!row || row.type !== "client/turn/requested") {
    return null;
  }
  const request = parseStoredTurnRequestEvent(row);
  if (
    request.source !== "spawn" ||
    request.request.method !== "thread/start" ||
    request.initiator !== "agent" ||
    request.senderThreadId === null ||
    request.target.kind !== "thread-start" ||
    !isDeferredFirstTurnContextInput(request.input)
  ) {
    return null;
  }
  return { input: request.input, requestSequence: row.sequence };
}

export function prependDeferredFirstTurnContext(
  prompt: GroupedPrompt,
  context: DeferredFirstTurnContext | null,
): GroupedPrompt;
export function prependDeferredFirstTurnContext(
  prompt: PromptWithGroups,
  context: DeferredFirstTurnContext | null,
): PromptWithGroups;
export function prependDeferredFirstTurnContext(
  prompt: PromptWithGroups,
  context: DeferredFirstTurnContext | null,
): PromptWithGroups {
  if (!context) {
    return prompt;
  }
  return {
    input: [...context.input, ...prompt.input],
    ...(prompt.inputGroups !== undefined
      ? {
          inputGroups: [
            [...context.input, ...prompt.inputGroups[0]!],
            ...prompt.inputGroups.slice(1),
          ],
        }
      : {}),
  };
}

export function requireDeferredFirstTurnContextCurrent(
  db: DbQueryConnection,
  args: { requestSequence: number; threadId: string },
): void {
  const current = resolveDeferredFirstTurnContext(db, args.threadId);
  if (current?.requestSequence === args.requestSequence) {
    return;
  }
  throw new ApiError(
    409,
    "invalid_request",
    "Thread already accepted its first real turn",
  );
}
