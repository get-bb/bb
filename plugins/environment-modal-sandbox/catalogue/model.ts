import { artifactMetadataSchema } from "./artifact.js";
import { experimental_PluginRpcConflict } from "@get-bb/plugin-sdk";
import { createHash } from "node:crypto";
import { z } from "zod";

export const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
export const idSchema = z.string().min(1).max(200);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const resourcesSchema = z
  .object({
    cpuCores: z.number().min(0.125).max(64).default(1),
    memoryMiB: z.number().int().min(128).max(262144).default(4096),
  })
  .strict();
export const policySchema = z
  .object({
    idleMinutes: z.number().int().min(0).max(1440).default(15),
    lifetimeMinutes: z.number().int().min(1).max(1440).default(1440),
    retentionDays: z.number().int().min(1).max(365).default(30),
  })
  .strict();
export const recipeInputSchema = z
  .object({
    projectId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    dockerfileText: z.string().max(256 * 1024),
    contextRules: z
      .object({
        include: z.array(z.string()).max(1000),
        exclude: z.array(z.string()).max(1000).default([]),
      })
      .strict()
      .default({ include: [], exclude: [] }),
    smoke: z
      .object({
        commands: z.array(z.string()).max(50).default([]),
        timeoutSeconds: z.number().int().min(1).max(600).default(120),
      })
      .strict()
      .default({ commands: [], timeoutSeconds: 120 }),
  })
  .strict();
export const recipeSchema = recipeInputSchema
  .omit({ expectedRevision: true })
  .extend({
    recipeId: idSchema,
    revision: z.number().int().positive(),
    recipeHash: hashSchema,
    baseDigest: hashSchema,
    createdAt: z.number(),
  });
export const fileSchema = z
  .object({
    path: z.string().min(1).max(4096),
    sha256: hashSchema,
    bytes: z.number().int().nonnegative(),
    mode: z.enum(["100644", "100755"]),
  })
  .strict();
export const sourceSchema = z
  .object({
    hostId: idSchema,
    path: z.string(),
    commit: z.string().regex(/^[a-f0-9]{40,64}$/),
    dirty: z.array(z.string()),
    submodules: z.array(z.string()),
    lfs: z.array(z.string()),
  })
  .strict();
export const manifestSchema = z
  .object({
    source: sourceSchema,
    files: z.array(fileSchema).max(20000),
    reviewedDirty: z.array(z.string()),
    recipeId: idSchema,
    revision: z.number().int().positive(),
  })
  .strict();
export const contextSchema = z.object({
  contextId: idSchema,
  projectId: idSchema,
  manifestHash: hashSchema,
  manifest: manifestSchema,
  bytes: z.number(),
  expiresAt: z.number(),
  uploaded: z.boolean(),
});
export const buildStateSchema = z.enum([
  "queued",
  "building",
  "ready",
  "failed",
  "cancelled",
  "reconciling",
]);
export const buildSchema = z.object({
  baseArtifact: artifactMetadataSchema.nullable().default(null),
  buildId: idSchema,
  projectId: idSchema,
  recipeId: idSchema,
  revision: z.number().int(),
  contextId: idSchema,
  accountIdentity: hashSchema,
  appName: idSchema,
  hash: hashSchema,
  name: idSchema,
  state: buildStateSchema,
  imageId: idSchema.nullable(),
  failure: z.string().nullable(),
  cancelRequested: z.boolean(),
  lastEventSequence: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export const eventSchema = z.object({
  sequence: z.number().int(),
  kind: z.enum(["log", "state", "truncated"]),
  text: z.string(),
  time: z.number(),
});
export const projectSchema = z.object({
  projectId: idSchema,
  revision: z.number().int(),
  usableBuildId: idSchema.nullable(),
  resources: resourcesSchema,
  policy: policySchema,
});
export type Recipe = z.infer<typeof recipeSchema>;
export type Context = z.infer<typeof contextSchema>;
export type Build = z.infer<typeof buildSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Project = z.infer<typeof projectSchema>;
export class CatalogueError extends experimental_PluginRpcConflict {
  constructor(
    public readonly status: number,
    message: string,
    latestRevision: number | null = null,
  ) {
    super(message, latestRevision);
    if (status !== 409) this.name = "CatalogueError";
  }
}

export const verificationSchema = z.object({
  verificationId: idSchema,
  buildId: idSchema,
  agentProviderId: idSchema,
  key: idSchema,
  state: z.enum([
    "queued",
    "allocating",
    "preparing",
    "starting",
    "running",
    "checking",
    "suspending",
    "resuming",
    "restoring",
    "retaining",
    "passed",
    "failed",
  ]),
  hostId: idSchema.nullable(),
  environmentId: idSchema.nullable(),
  threadId: idSchema.nullable(),
  completedTurnSeq: z.number().int().nullable(),
  restored: z.boolean().default(false),
  checks: z.array(
    z.object({ command: z.string(), exitCode: z.number().int() }),
  ),
  failure: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Verification = z.infer<typeof verificationSchema>;
