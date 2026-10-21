import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";

export const readDependencySchema = z
  .object({
    entity: z.string().min(1),
    id: z.string().min(1).optional(),
    changes: z.array(z.string().min(1)).min(1).readonly(),
  })
  .strict();
export const readChangeSchema = readDependencySchema.extend({
  value: jsonValueSchema.optional(),
});
export type ReadDependency = z.infer<typeof readDependencySchema>;
export type ReadChange = z.infer<typeof readChangeSchema>;
export type ReadChangeReaction<Data> =
  | { action: "reload"; keys?: readonly string[] }
  | { action: "patch"; data: Data }
  | undefined;

export const pluginRpcEnvelopeSchema = z.object({
  result: jsonValueSchema,
  whileWatched: z.boolean().default(false),
  dependencies: z.array(readDependencySchema).default([]),
  keyDependencies: z
    .record(z.string(), z.array(readDependencySchema))
    .default({}),
  changes: z.array(readChangeSchema).default([]),
});
