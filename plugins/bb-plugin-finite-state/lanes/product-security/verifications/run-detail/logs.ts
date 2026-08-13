import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const SAFE_SURFACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
export const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/u;

const cacheSchema = z.object({
  state: z.enum(["fresh", "stale", "empty"]), asOf: z.string().nullable(),
  message: z.string().nullable(), acceptedGenerationId: z.string().nullable(), baseRevision: z.number().int().nonnegative(),
}).strict();

export const verificationRunDetailRpcContract = defineRpcContract({
  verificationResultHistoryList: {
    input: z.object({
      projectId: z.string().min(1), projectVersionId: z.string().nullable(),
      requirementId: z.string().min(1), tier: z.enum(["static", "emulation", "hil", "manual", "hardware"]),
      pageSize: z.number().int().min(1).max(200).default(50), continuation: z.string().nullable().default(null),
    }).strict(),
    output: z.object({
      items: z.array(z.object({
        projectId: z.string(), projectVersionId: z.string().nullable(), kind: z.string(), key: z.string(), label: z.string(), fields: z.record(z.string(), z.unknown()),
      }).strict()), total: z.number().int().nonnegative(), next: z.string().nullable(), cache: cacheSchema,
    }).strict(),
  },
});

export function parseByteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (!match) throw new Error("INVALID_RANGE");
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) throw new Error("INVALID_RANGE");
  return { start, end: Math.min(requestedEnd, size - 1) };
}
