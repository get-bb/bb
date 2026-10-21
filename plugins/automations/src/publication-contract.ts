import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const branchSchema = z.string().min(1).max(1024);
const commitSchema = z.string().regex(/^[0-9a-f]{40,64}$/);

export const publicationSnapshotSchema = z
  .object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    branch: branchSchema,
    commit: commitSchema,
    baseBranch: branchSchema,
    baseCommit: commitSchema,
  })
  .strict();

export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;

export const publicationInspectionSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("ready"), snapshot: publicationSnapshotSchema })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum([
        "dirty_worktree",
        "detached_head",
        "default_branch",
        "no_changes",
        "repository_unavailable",
        "base_unavailable",
      ]),
    })
    .strict(),
]);

export const publicationHostContract = defineRpcContract({
  inspectPublication: {
    input: z
      .object({ path: z.string().min(1), baseBranch: branchSchema.nullable() })
      .strict(),
    output: publicationInspectionSchema,
  },
  publish: {
    input: z
      .object({
        path: z.string().min(1),
        snapshot: publicationSnapshotSchema,
        title: z.string().trim().min(1).max(256),
        body: z.string().max(60_000),
      })
      .strict(),
    output: z.object({ url: z.string().url() }).strict(),
  },
});
