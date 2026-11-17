import { getThread, listStoredTaskTurnRequestEvents } from "@bb/db";
import type { PromptInput, ThreadEvent } from "@bb/domain";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { parseStoredTurnRequestEvent } from "./thread-events.js";
import { titleUntitledThreadFromInput } from "./title-generation.js";

const MAX_PROVIDER_INPUT_TITLE_SOURCE_LENGTH = 8000;

function hasVisibleText(input: PromptInput[]): boolean {
  return input.some(
    (part) =>
      part.type === "text" &&
      part.visibility !== "agent-only" &&
      part.text.trim().length > 0,
  );
}

export function titleUntitledThreadFromProviderInput(
  deps: CommandResultSideEffectsDeps & LoggedWorkSessionDeps,
  args: { threadId: string; event: ThreadEvent },
): void {
  const { event } = args;
  if (
    event.type !== "item/completed" ||
    event.item.type !== "userMessage" ||
    event.item.clientRequestId !== undefined ||
    event.item.parentToolCallId !== undefined
  ) {
    return;
  }
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.title || thread.originKind !== null) {
    return;
  }
  const [latestRequest] = listStoredTaskTurnRequestEvents(deps.db, {
    threadId: thread.id,
    order: "newest",
    limit: 1,
  });
  if (
    latestRequest !== undefined &&
    hasVisibleText(parseStoredTurnRequestEvent(latestRequest).input)
  ) {
    return;
  }
  const text = event.item.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
    .slice(0, MAX_PROVIDER_INPUT_TITLE_SOURCE_LENGTH);
  if (text.length === 0) {
    return;
  }
  void titleUntitledThreadFromInput(deps, {
    threadId: thread.id,
    input: [{ type: "text", text, mentions: [] }],
  }).catch((error: unknown) => {
    deps.logger.warn(
      { threadId: thread.id, ...runtimeErrorLogFields(deps.config, error) },
      "Failed to title a thread from provider input",
    );
  });
}
