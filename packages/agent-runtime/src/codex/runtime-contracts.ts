import { Ajv } from "ajv";
import type { FromSchema } from "json-schema-to-ts";
import { codexThreadItemJsonSchema } from "./generated/codex-app-server/runtime/ThreadItem.schema.js";

type RawCodexThreadItem = FromSchema<
  typeof codexThreadItemJsonSchema,
  { keepDefaultedPropertiesOptional: true }
>;
export type CodexThreadItem = FromSchema<typeof codexThreadItemJsonSchema>;

const ajv = new Ajv({
  strict: true,
  validateFormats: false,
});
const validateThreadItem = ajv.compile<RawCodexThreadItem>(
  codexThreadItemJsonSchema,
);

type RawUserInput = Extract<
  RawCodexThreadItem,
  { type: "userMessage" }
>["content"][number];

function normalizeUserInput(value: RawUserInput) {
  switch (value.type) {
    case "text":
      return { ...value, text_elements: value.text_elements ?? [] };
    case "image":
    case "localImage":
      return { ...value, detail: value.detail ?? null };
    case "audio":
    case "localAudio":
    case "skill":
    case "mention":
      return value;
  }
}

function normalizeThreadItem(value: RawCodexThreadItem): CodexThreadItem {
  switch (value.type) {
    case "userMessage":
      return { ...value, content: value.content.map(normalizeUserInput) };
    case "agentMessage":
      return {
        ...value,
        memoryCitation: value.memoryCitation ?? null,
        phase: value.phase ?? null,
      };
    case "reasoning":
      return {
        ...value,
        content: value.content ?? [],
        summary: value.summary ?? [],
      };
    case "commandExecution":
      return {
        ...value,
        pluginId: value.pluginId ?? null,
        scriptPath: value.scriptPath ?? null,
        source: value.source ?? "agent",
      };
    case "webSearch":
      return { ...value, results: value.results ?? null };
    case "hookPrompt":
    case "plan":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "collabAgentToolCall":
    case "subAgentActivity":
    case "imageView":
    case "sleep":
    case "imageGeneration":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      return value;
  }
}

export function decodeCodexThreadItem(value: unknown): CodexThreadItem | null {
  return validateThreadItem(value) ? normalizeThreadItem(value) : null;
}
