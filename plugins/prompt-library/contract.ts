import {
  defineRpcContract,
  type ComposerDraftReplacement,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMention(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.from) &&
    Number.isInteger(value.to) &&
    typeof value.label === "string" &&
    typeof value.kind === "string"
  );
}

function isAttachment(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.type === "localImage" || value.type === "localFile") &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.sizeBytes === "number"
  );
}

function isPrompt(value: unknown): value is ComposerDraftReplacement {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    Array.isArray(value.mentions) &&
    value.mentions.every(isMention) &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) &&
        value.attachments.every(isAttachment)))
  );
}

export const promptSchema = z.custom<ComposerDraftReplacement>(
  isPrompt,
  "Invalid prompt",
);

export const promptScopeSchema = z.enum(["thread", "project", "global"]);
export type PromptScope = z.infer<typeof promptScopeSchema>;

const snippetSchema = z
  .object({
    text: z.string(),
    highlights: z.array(z.tuple([z.number().int(), z.number().int()])),
  })
  .strict();
export type PromptSnippet = z.infer<typeof snippetSchema>;

const starredPromptSchema = z
  .object({
    id: z.string(),
    prompt: promptSchema,
    snippet: snippetSchema,
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
  })
  .strict();
export type StarredPromptRow = z.infer<typeof starredPromptSchema>;

const recentPromptSchema = z
  .object({
    id: z.string(),
    prompt: promptSchema,
    snippet: snippetSchema,
    createdAt: z.number(),
    projectId: z.string(),
    projectName: z.string().nullable(),
    threadId: z.string(),
    starredId: z.string().nullable(),
  })
  .strict();
export type RecentPromptRow = z.infer<typeof recentPromptSchema>;

export const searchPromptsInputSchema = z
  .object({
    query: z.string().max(256),
    scope: promptScopeSchema,
    projectId: z.string().min(1).nullable(),
    threadId: z.string().min(1).nullable(),
  })
  .strict();
export type SearchPromptsInput = z.infer<typeof searchPromptsInputSchema>;

export const promptLibraryRpcContract = defineRpcContract({
  search: {
    input: searchPromptsInputSchema,
    output: z
      .object({
        starred: z.array(starredPromptSchema),
        recent: z.array(recentPromptSchema),
      })
      .strict(),
  },
  star: {
    input: z.object({ prompt: promptSchema }).strict(),
    output: z.object({ id: z.string() }).strict(),
  },
  unstar: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ unstarred: z.boolean() }).strict(),
  },
  markUsed: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.null(),
  },
});
