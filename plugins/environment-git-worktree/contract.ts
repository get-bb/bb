import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { environmentHostProgressSchema } from "bb-environment-provider-host/progress";

export const worktreeBaseBranchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("default") }).strict(),
]);
export type WorktreeBaseBranch = z.infer<typeof worktreeBaseBranchSchema>;

export const discoveredWorktreeSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().nullable(),
    locked: z.boolean(),
    prunable: z.boolean(),
  })
  .strict();
export type DiscoveredWorktree = z.infer<typeof discoveredWorktreeSchema>;

export const ownedBranchSchema = z
  .object({
    name: z.string().min(1),
    repositoryPath: z.string().min(1),
    baseBranch: z.string().min(1).nullable(),
  })
  .strict();

export const MAX_POOL_SIZE = 4;

export const worktreeHostContract = defineRpcContract({
  defaultBaseBranch: {
    input: z.object({ sourcePath: z.string().min(1) }).strict(),
    output: z.object({ branch: z.string().min(1).nullable() }).strict(),
  },
  listWorktrees: {
    input: z.object({ sourcePath: z.string().min(1) }).strict(),
    output: z.object({ worktrees: z.array(discoveredWorktreeSchema) }).strict(),
  },
  resolveExistingWorktree: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        path: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("resolved"),
          path: z.string().min(1),
          branch: z.string().nullable(),
        })
        .strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  create: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1),
        pathKey: z.string().min(1),
        branchName: z.string().min(1).nullable(),
        baseBranch: worktreeBaseBranchSchema,
        branchMode: z.enum(["reset", "reuse-existing"]),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("created"),
          path: z.string().min(1),
          baseBranch: z.string().min(1).nullable(),
          ownsBranch: z.boolean(),
        })
        .strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  nameBranch: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1),
        path: z.string().min(1),
        branchName: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("named") }).strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  refreshPoolBase: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        memberPaths: z.array(z.string().min(1)),
      })
      .strict(),
    output: z
      .object({
        ref: z.string().min(1).nullable(),
        commit: z.string().min(1).nullable(),
        members: z.array(
          z
            .object({
              path: z.string().min(1),
              head: z.string().min(1).nullable(),
              branch: z.string().min(1).nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  handOff: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        path: z.string().min(1),
        fromBranch: z.string().min(1),
        toBranch: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("handed-off"),
          baseBranch: z.string().min(1),
        })
        .strict(),
      z
        .object({ status: z.literal("refused"), reason: z.string().min(1) })
        .strict(),
      z.object({ status: z.literal("busy") }).strict(),
    ]),
  },
  restorePoolMember: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        path: z.string().min(1),
        placeholder: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("intact") }).strict(),
      z.object({ status: z.literal("restored") }).strict(),
      z
        .object({
          status: z.literal("used"),
          branch: z.string().min(1).nullable(),
        })
        .strict(),
    ]),
  },
  remove: {
    input: z
      .object({
        operationId: z.string().min(1),
        pathKey: z.string().min(1),
        path: z.string().min(1).nullable(),
        ownedBranch: ownedBranchSchema.nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("removed") }).strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
});

export const worktreeHostSignals = {
  progress: {
    payload: environmentHostProgressSchema,
  },
} as const;
