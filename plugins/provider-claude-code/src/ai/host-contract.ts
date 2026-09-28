import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const claudeAiFailureCodeSchema = z.enum([
  "timeout",
  "rate_limited",
  "service_unavailable",
  "auth_required",
  "request_failed",
  "invalid_response",
]);
export type ClaudeAiFailureCode = z.infer<typeof claudeAiFailureCodeSchema>;

const failureSchema = z
  .object({
    ok: z.literal(false),
    code: claudeAiFailureCodeSchema,
    message: z.string().min(1),
  })
  .strict();

const textResultSchema = z.union([
  z.object({ ok: z.literal(true), text: z.string() }).strict(),
  failureSchema,
]);
export type ClaudeAiTextResult = z.infer<typeof textResultSchema>;

export const claudeAiCompleteInputSchema = z
  .object({
    model: z.string().min(1),
    prompt: z.string().min(1),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type ClaudeAiCompleteInput = z.infer<typeof claudeAiCompleteInputSchema>;

export const claudeAiStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true) }).strict(),
  z.object({ ready: z.literal(false), message: z.string().min(1) }).strict(),
]);
export type ClaudeAiStatus = z.infer<typeof claudeAiStatusSchema>;

export const claudeAiHostContract = defineRpcContract({
  "claude.ai.complete": {
    input: claudeAiCompleteInputSchema,
    output: textResultSchema,
  },
  "claude.ai.status": {
    input: z.object({}).strict(),
    output: claudeAiStatusSchema,
  },
});
