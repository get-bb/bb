import { z } from "zod";

export const readinessInspectCommandSchema = z
  .object({
    type: z.literal("workspace.readiness.inspect"),
    path: z.string().min(1),
  })
  .strict();
export const readinessInspectResultSchema = z
  .object({
    commit: z.string(),
    dirty: z.array(z.string()),
    files: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()),
    abi: z.string(),
  })
  .strict();
export const readinessRunCommandSchema = z
  .object({
    type: z.literal("workspace.readiness.run"),
    path: z.string().min(1),
    script: z.string().max(256 * 1024),
    env: z.record(z.string(), z.string()),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(10 * 60 * 1000),
  })
  .strict();
export const readinessRunResultSchema = z
  .object({ exitCode: z.number().int() })
  .strict();
export const readinessProbeCommandSchema = z
  .object({
    type: z.literal("host.readiness.probe"),
    serverPath: z.string().startsWith("/"),
    headers: z.record(z.string(), z.string()),
  })
  .strict();
export const readinessProbeResultSchema = z
  .object({ reachable: z.boolean(), status: z.number().int().nullable() })
  .strict();
