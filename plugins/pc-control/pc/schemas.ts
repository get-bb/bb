import { z } from "zod";

export const percentSchema = z.number().min(0).max(100);
export const bytesSchema = z.number().int().nonnegative();

export const systemSnapshotSchema = z
  .object({
    cpuPercent: percentSchema.nullable(),
    cpuCores: z.number().int().positive(),
    memoryTotalBytes: bytesSchema,
    memoryUsedBytes: bytesSchema,
    memoryUsedPercent: percentSchema,
    uptimeSeconds: z.number().nonnegative(),
    collectedAt: z.string().min(1),
  })
  .strict();
export type SystemSnapshot = z.infer<typeof systemSnapshotSchema>;

export const processSampleSchema = z
  .object({
    pid: z.number().int().positive(),
    name: z.string().min(1).max(200),
    cpuPercent: percentSchema.nullable(),
    memoryBytes: bytesSchema,
  })
  .strict();
export type ProcessSample = z.infer<typeof processSampleSchema>;

export const processListOutputSchema = z
  .object({
    collectedAt: z.string().min(1),
    processes: z.array(processSampleSchema).max(600),
    truncated: z.boolean(),
  })
  .strict();
export type ProcessListOutput = z.infer<typeof processListOutputSchema>;

export const exePathSchema = z.string().min(2).max(600);
export const cwdPathSchema = z.string().min(1).max(600);
export const processNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => !/[\\/\0]/u.test(value),
    "Process name must be a file name without separators",
  );

export const appProfileSchema = z
  .object({
    id: z.string().regex(/^pcp_[0-9a-z]{6,16}$/u),
    name: z.string().min(1).max(64),
    exePath: exePathSchema,
    args: z.array(z.string().min(1).max(1024)).max(32),
    cwd: cwdPathSchema,
    processName: processNameSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type AppProfile = z.infer<typeof appProfileSchema>;

export const appProfileInputSchema = z
  .object({
    id: z.string().regex(/^pcp_[0-9a-z]{6,16}$/u).optional(),
    name: z.string().min(1).max(64),
    exePath: exePathSchema,
    args: z.array(z.string().min(1).max(1024)).max(32),
    cwd: cwdPathSchema.optional(),
    processName: processNameSchema.nullable().optional(),
  })
  .strict();
export type AppProfileInput = z.infer<typeof appProfileInputSchema>;

export const profileStatusSchema = z
  .object({
    running: z.boolean(),
    pids: z.array(z.number().int().positive()).max(32),
  })
  .strict();
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

export const profileWithStatusSchema = appProfileSchema.extend({
  status: profileStatusSchema,
});
export type ProfileWithStatus = z.infer<typeof profileWithStatusSchema>;

export const hostSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.enum(["connected", "disconnected"]),
  })
  .strict();
export type HostSummary = z.infer<typeof hostSummarySchema>;
