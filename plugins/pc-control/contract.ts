import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  appProfileInputSchema,
  appProfileSchema,
  hostSummarySchema,
  processListOutputSchema,
  profileWithStatusSchema,
  systemSnapshotSchema,
} from "./pc/schemas.js";

export {
  appProfileSchema,
  appProfileInputSchema,
  hostSummarySchema,
  processListOutputSchema,
  processSampleSchema,
  profileStatusSchema,
  profileWithStatusSchema,
  systemSnapshotSchema,
} from "./pc/schemas.js";
export type {
  AppProfile,
  AppProfileInput,
  HostSummary,
  ProcessListOutput,
  ProcessSample,
  ProfileStatus,
  ProfileWithStatus,
  SystemSnapshot,
} from "./pc/schemas.js";

const processesInputSchema = z
  .object({
    query: z.string().max(200).optional(),
    sortBy: z.enum(["cpu", "memory"]).default("cpu"),
    limit: z.number().int().min(1).max(100).default(40),
  })
  .strict();

export const pcControlRpcContract = defineRpcContract({
  overview: {
    input: z.null(),
    output: z
      .object({
        host: hostSummarySchema,
        snapshot: systemSnapshotSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  },
  processes: {
    input: processesInputSchema,
    output: processListOutputSchema
      .extend({
        totalMatched: z.number().int().nonnegative(),
        hostError: z.string().nullable(),
      })
      .strict(),
  },
  profiles: {
    input: z.null(),
    output: z
      .object({
        host: hostSummarySchema.nullable(),
        profiles: z.array(profileWithStatusSchema).max(32),
        error: z.string().nullable(),
      })
      .strict(),
  },
  saveProfile: {
    input: appProfileInputSchema,
    output: z
      .object({
        profile: appProfileSchema,
      })
      .strict(),
  },
  deleteProfile: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  startProfile: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ pid: z.number().int().positive() }).strict(),
  },
  stopProfile: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z
      .object({
        stoppedCount: z.number().int().nonnegative(),
      })
      .strict(),
  },
  restartProfile: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ pid: z.number().int().positive() }).strict(),
  },
});
