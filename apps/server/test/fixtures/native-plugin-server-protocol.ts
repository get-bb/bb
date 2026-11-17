import { z } from "zod";

export const nativePluginRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prebuilt"),
    rootDir: z.string(),
    dataDir: z.string(),
  }),
  z.object({
    kind: z.literal("source"),
    rootDir: z.string(),
    dataDir: z.string(),
  }),
  z.object({
    kind: z.literal("reload"),
    importedDir: z.string(),
    importerDir: z.string(),
    dataDir: z.string(),
  }),
]);

export type NativePluginRequest = z.infer<typeof nativePluginRequestSchema>;

export const nativePluginResultSchema = z.union([
  z.object({
    status: z.string(),
    statusDetail: z.string().nullable(),
    types: z.tuple([z.string(), z.string()]),
  }),
  z.object({
    status: z.string(),
    statusDetail: z.string().nullable(),
    value: z.tuple([z.string(), z.string()]),
  }),
  z.object({ before: z.string(), after: z.string() }),
]);

export type NativePluginResult = z.infer<typeof nativePluginResultSchema>;

export const nativePluginMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("result"), result: nativePluginResultSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
