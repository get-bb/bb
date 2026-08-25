import { z } from "zod";

/**
 * Sessionless provider command discovery. The cwd is required because command
 * resources can be project-scoped and must never inherit the bridge process's
 * ambient working directory.
 */
export const experimental_providerCommandListParamsSchema = z
  .object({
    providerId: z.string().min(1),
    cwd: z.string().min(1),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ExperimentalProviderCommandListParams = z.infer<
  typeof experimental_providerCommandListParamsSchema
>;

export const experimental_providerCommandSchema = z
  .object({
    name: z.string().min(1),
    source: z.enum(["skill", "command"]),
    origin: z.enum(["project", "user"]),
    description: z.string().nullable(),
    argumentHint: z.string().nullable(),
  })
  .passthrough();

export type ExperimentalProviderCommand = z.infer<
  typeof experimental_providerCommandSchema
>;

/**
 * Partial discovery is successful: diagnostics describe broken resources while
 * commands from healthy resources remain available.
 */
export const experimental_providerCommandListResultSchema =
  z.discriminatedUnion("supported", [
    z.object({ supported: z.literal(false) }).passthrough(),
    z
      .object({
        supported: z.literal(true),
        commands: z.array(experimental_providerCommandSchema),
        diagnostics: z.array(z.string()),
      })
      .passthrough(),
  ]);

export type ExperimentalProviderCommandListResult = z.infer<
  typeof experimental_providerCommandListResultSchema
>;
