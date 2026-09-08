import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  buildSchema,
  contextSchema,
  eventSchema,
  idSchema,
  policySchema,
  projectSchema,
  recipeInputSchema,
  recipeSchema,
  resourcesSchema,
} from "./model.js";
import { inspectionSchema } from "./source-contract.js";

const project = z.object({ projectId: idSchema }).strict();
const build = z.object({ buildId: idSchema }).strict();
const page = z
  .object({
    cursor: idSchema.nullable().default(null),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const modalRpcContract = defineRpcContract({
  "project.inspect": {
    input: project.extend({ environmentId: idSchema }),
    output: inspectionSchema,
  },
  "recipe.put": { input: recipeInputSchema, output: recipeSchema },
  "recipe.get": { input: project, output: recipeSchema },
  "recipe.list": {
    input: page,
    output: z.object({
      recipes: z.array(recipeSchema),
      nextCursor: idSchema.nullable(),
    }),
  },
  "context.prepare": {
    input: project.extend({
      environmentId: idSchema,
      recipeId: idSchema,
      revision: z.number().int().positive(),
      reviewedDirty: z.array(z.string()).default([]),
    }),
    output: contextSchema.extend({
      files: z.number(),
      uploadToken: z.string(),
      uploadUrl: z.string(),
    }),
  },
  "context.upload": {
    input: z.object({ contextId: idSchema, uploadToken: z.string() }).strict(),
    output: contextSchema,
  },
  "context.complete": {
    input: z.object({ contextId: idSchema }).strict(),
    output: contextSchema,
  },
  "build.start": {
    input: project.extend({
      recipeId: idSchema,
      revision: z.number().int().positive(),
      contextId: idSchema,
      key: idSchema,
    }),
    output: z.object({
      buildId: idSchema,
      state: buildSchema.shape.state,
      reused: z.boolean(),
    }),
  },
  "build.events": {
    input: build.extend({
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(200),
    }),
    output: z.object({
      events: z.array(eventSchema),
      nextCursor: z.number(),
      terminal: z.boolean(),
    }),
  },
  "build.get": { input: build, output: buildSchema },
  "build.cancel": { input: build, output: buildSchema },
  "image.list": {
    input: page.extend({ projectId: idSchema.nullable().default(null) }),
    output: z.object({
      images: z.array(buildSchema),
      nextCursor: idSchema.nullable(),
    }),
  },
  "image.gc": {
    input: z.object({ dryRun: z.boolean() }).strict(),
    output: z.object({
      candidates: z.array(
        z.object({
          buildId: idSchema,
          imageId: idSchema,
          markedAt: z.number().nullable(),
          deleted: z.boolean(),
        }),
      ),
      blockedReferences: z.array(idSchema),
    }),
  },
  "project.configure": {
    input: project.extend({
      resources: resourcesSchema,
      policy: policySchema,
      expectedRevision: z.number().int().nonnegative(),
    }),
    output: projectSchema,
  },
  "project.show": {
    input: project,
    output: projectSchema.extend({
      staleness: z.object({
        dockerfileChanged: z.boolean(),
        lockfilesChanged: z.boolean().nullable(),
        reason: z.string().nullable(),
        lastCheckedAt: z.number().nullable(),
      }),
    }),
  },
});
