import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { fileSchema, manifestSchema, sourceSchema } from "./model.js";

export const isLockfile = (path: string) =>
  /(^|\/)(?:.*lock.*|go\.sum|Cargo\.lock)$/i.test(path);

export const inspectionSchema = z.object({
  source: sourceSchema,
  evidence: z.array(fileSchema.extend({ kind: z.string() })),
  setupHooks: z.array(z.string()),
  missing: z.array(z.string()),
});
export const sourceContract = defineRpcContract({
  inspect: {
    input: z.object({ path: z.string(), hostId: z.string() }).strict(),
    output: inspectionSchema,
  },
  manifest: {
    input: z
      .object({
        path: z.string(),
        hostId: z.string(),
        recipeId: z.string(),
        revision: z.number().int(),
        include: z.array(z.string()),
        exclude: z.array(z.string()),
        reviewedDirty: z.array(z.string()),
      })
      .strict(),
    output: manifestSchema,
  },
  upload: {
    input: z
      .object({
        path: z.string(),
        manifest: manifestSchema,
        url: z.string().url(),
        token: z.string(),
        contextId: z.string(),
      })
      .strict(),
    output: z.object({ uploaded: z.boolean() }),
  },
});
