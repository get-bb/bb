import type { PromptMentionResource } from "@bb/domain";

export const CREATE_LOOP_PROMPT = "Create a new bb loop to ";
export const SUBMITTED_LOOP_PROMPT_PREFIX = CREATE_LOOP_PROMPT.trimEnd();

export function isLoopPromptCommandResource(
  resource: PromptMentionResource,
): boolean {
  return (
    resource.kind === "command" &&
    resource.trigger === "/" &&
    resource.name === "loop" &&
    resource.source === "command" &&
    resource.origin === "user"
  );
}
