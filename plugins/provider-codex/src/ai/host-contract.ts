import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const codexAiFailureCodeSchema = z.enum([
  "timeout",
  "rate_limited",
  "service_unavailable",
  "auth_required",
  "request_failed",
  "invalid_response",
]);
export type CodexAiFailureCode = z.infer<typeof codexAiFailureCodeSchema>;

const failureSchema = z
  .object({
    ok: z.literal(false),
    code: codexAiFailureCodeSchema,
    message: z.string().min(1),
  })
  .strict();

const textResultSchema = z.union([
  z.object({ ok: z.literal(true), text: z.string() }).strict(),
  failureSchema,
]);
export type CodexAiTextResult = z.infer<typeof textResultSchema>;

export const codexAiCompleteInputSchema = z
  .object({
    model: z.string().min(1),
    prompt: z.string().min(1),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type CodexAiCompleteInput = z.infer<typeof codexAiCompleteInputSchema>;

export const codexAiTranscribeInputSchema = z
  .object({
    model: z.string().min(1),
    audioBase64: z.string().min(1),
    mimeType: z.string().min(1),
    filename: z.string().min(1),
    hint: z.string().nullable(),
    timeoutMs: z.number().int().positive(),
  })
  .strict();
export type CodexAiTranscribeInput = z.infer<
  typeof codexAiTranscribeInputSchema
>;

export const codexAiStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true) }).strict(),
  z.object({ ready: z.literal(false), message: z.string().min(1) }).strict(),
]);
export type CodexAiStatus = z.infer<typeof codexAiStatusSchema>;

export const codexAiHostContract = defineRpcContract({
  "codex.ai.complete": {
    input: codexAiCompleteInputSchema,
    output: textResultSchema,
  },
  "codex.ai.transcribe": {
    input: codexAiTranscribeInputSchema,
    output: textResultSchema,
  },
  "codex.ai.status": {
    input: z.object({}).strict(),
    output: codexAiStatusSchema,
  },
});
