import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

const toolchainCapabilitySchema = z.enum([
  "build",
  "flash",
  "zephyr-workspace",
]);

export const toolchainAdvisorySchema = z.object({
  state: z.enum(["detecting", "ready", "degraded", "unavailable", "error"]),
  configured: z.boolean(),
  found: z.array(z.object({
    id: z.string().min(1).max(101),
    version: z.string().min(1).max(1000),
  }).strict()).max(20),
  missing: z.array(z.object({
    id: z.string().min(1).max(101),
    unlocks: toolchainCapabilitySchema,
  }).strict()).max(20),
  message: z.string().min(1).max(4000),
  checkedAt: z.iso.datetime().nullable(),
}).strict();

export type ToolchainAdvisory = z.infer<typeof toolchainAdvisorySchema>;

export const authoringToolchainRpcContract = defineRpcContract({
  authoringToolchainStatus: {
    input: z.null(),
    output: toolchainAdvisorySchema,
  },
} as const);
