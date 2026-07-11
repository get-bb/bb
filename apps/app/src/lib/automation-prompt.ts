import type { PromptMentionResource } from "@bb/domain";

export const CREATE_AUTOMATION_PROMPT = "Create a new bb automation to ";
export const SUBMITTED_AUTOMATION_PROMPT_PREFIX =
  CREATE_AUTOMATION_PROMPT.trimEnd();

export function isAutomationPromptCommandResource(
  resource: PromptMentionResource,
): boolean {
  return (
    resource.kind === "command" &&
    resource.trigger === "/" &&
    (resource.name === "automation" || resource.name === "loop") &&
    resource.source === "command" &&
    resource.origin === "user"
  );
}
