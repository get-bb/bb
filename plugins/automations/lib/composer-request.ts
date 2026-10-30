import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import type { AgentExecutionUpdate } from "../src/rpc-types";

type ComposerPromptInput = NewThreadRequest["input"][number];
type ComposerTextInput = Extract<ComposerPromptInput, { type: "text" }>;
type ComposerTextMention = ComposerTextInput["mentions"][number];

export const AUTOMATION_PROMPT_TEXT_ONLY_MESSAGE =
  "An automation prompt is text only. Remove the attachment to save.";
export const AUTOMATION_PROJECT_FIXED_MESSAGE =
  "An automation stays in its project.";
export const AUTOMATION_PROMPT_REQUIRED_MESSAGE =
  "Add a prompt before saving.";
export const AUTOMATION_PROMPT_PLUGIN_MENTION_MESSAGE =
  "An automation prompt cannot keep plugin mentions. Remove the mention to save.";

function mentionToken(mention: ComposerTextMention): string | null {
  const resource = mention.resource;
  switch (resource.kind) {
    case "thread":
      return `@thread:${resource.threadId}`;
    case "project":
      return `@project:${resource.projectId}`;
    case "section":
      return `@section:${resource.sectionId}`;
    default:
      return null;
  }
}

function serializeTextInput(input: ComposerTextInput): string {
  const mentions = [...input.mentions].sort(
    (left, right) => left.start - right.start,
  );
  let text = "";
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.resource.kind === "attachment") {
      throw new Error(AUTOMATION_PROMPT_TEXT_ONLY_MESSAGE);
    }
    if (mention.resource.kind === "plugin") {
      throw new Error(AUTOMATION_PROMPT_PLUGIN_MENTION_MESSAGE);
    }
    if (mention.start < cursor) continue;
    text += input.text.slice(cursor, mention.start);
    text +=
      mentionToken(mention) ?? input.text.slice(mention.start, mention.end);
    cursor = mention.end;
  }
  return text + input.text.slice(cursor);
}

export function automationPromptFromComposerInput(
  input: NewThreadRequest["input"],
): string {
  const parts: string[] = [];
  for (const item of input) {
    if (item.type !== "text") {
      throw new Error(AUTOMATION_PROMPT_TEXT_ONLY_MESSAGE);
    }
    parts.push(serializeTextInput(item));
  }
  return parts.join("").trim();
}

export function agentUpdateFromComposerRequest(
  request: NewThreadRequest,
  projectId: string,
): AgentExecutionUpdate {
  if (request.projectId !== projectId) {
    throw new Error(AUTOMATION_PROJECT_FIXED_MESSAGE);
  }
  const prompt = automationPromptFromComposerInput(request.input);
  if (prompt.length === 0) {
    throw new Error(AUTOMATION_PROMPT_REQUIRED_MESSAGE);
  }
  const sessionOptions =
    request.sessionOptions !== undefined &&
    Object.keys(request.sessionOptions).length > 0
      ? request.sessionOptions
      : null;
  return {
    prompt,
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
    serviceTier: request.serviceTier ?? null,
    permissionMode: request.permissionMode,
    sessionOptions,
    target: { type: "environment", environment: request.environment },
  };
}
