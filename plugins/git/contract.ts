import { filePathSchema } from "./host-contract.js";
import {
  environmentStatusResponseSchema,
  environmentDiffFilesResponseSchema,
  environmentDiffResponseSchema,
  environmentDiffViewedResponseSchema,
  diffPatchEntrySchema,
} from "./read-contract.js";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  environmentSchema,
  gitBranchNameSchema,
  gitBranchOptionsSchema,
} from "@bb/domain";
import { workspaceDiffTargetSchema } from "bb-git-contract";
export {
  gitHostContract,
  gitHostSignals,
  unavailableSchema,
  filePathSchema,
} from "./host-contract.js";

const target = workspaceDiffTargetSchema;
const status = z
  .object({
    environmentId: z.string().min(1),
    mergeBaseBranch: gitBranchNameSchema.nullable(),
  })
  .strict();
const files = z
  .object({
    environmentId: z.string().min(1),
    target,
    ignoreWhitespace: z.boolean(),
  })
  .strict();
export const gitDependencies = (input: { environmentId: string }) => [
  { entity: "workspace", id: input.environmentId, changes: ["changed"] },
];
export const patchKeySchema = z
  .object({
    environmentId: z.string().min(1),
    target,
    path: filePathSchema,
    ignoreWhitespace: z.boolean(),
  })
  .strict();
export function parsePatchKey(key: string) {
  const value: unknown = JSON.parse(key);
  return patchKeySchema.parse(value);
}
export const gitSectionIdSchema = z.enum(["commits", "uncommittedChanges"]);
export const gitCollapsedSectionsSchema = z.array(gitSectionIdSchema);
export const gitRpcContract = defineRpcContract({
  patches: {
    input: z.object({ keys: z.array(z.string().min(1)).max(500) }).strict(),
    output: z.record(z.string(), diffPatchEntrySchema),
    experimental_keyDependencies(key) {
      const input = parsePatchKey(key);
      return [
        {
          entity: "git-file",
          id: `${input.environmentId}:${input.path}`,
          changes: ["changed"],
        },
        { entity: "git-refs", id: input.environmentId, changes: ["changed"] },
      ];
    },
  },
  collapsedSections: {
    input: z.null(),
    output: gitCollapsedSectionsSchema,
    experimental_dependencies: () => [
      { entity: "collapsed-sections", changes: ["changed"] },
    ],
  },
  setSectionCollapsed: {
    input: z
      .object({ sectionId: gitSectionIdSchema, collapsed: z.boolean() })
      .strict(),
    output: gitCollapsedSectionsSchema,
    experimental_changes: () => [
      { entity: "collapsed-sections", changes: ["changed"] },
    ],
  },
  viewed: {
    input: z
      .object({
        environmentId: z.string().min(1),
        target,
        paths: z.array(filePathSchema).max(500).optional(),
      })
      .strict(),
    output: environmentDiffViewedResponseSchema,
    experimental_dependencies: (input) => [
      { entity: "viewed", id: input.environmentId, changes: ["changed"] },
    ],
  },
  clearViewed: {
    input: z.object({ environmentId: z.string().min(1), target }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    experimental_changes: (input) => [
      { entity: "viewed", id: input.environmentId, changes: ["changed"] },
    ],
  },
  setViewed: {
    input: z.discriminatedUnion("viewed", [
      z
        .object({
          environmentId: z.string().min(1),
          target,
          path: filePathSchema,
          revision: z.string().min(1),
          viewed: z.literal(true),
        })
        .strict(),
      z
        .object({
          environmentId: z.string().min(1),
          target,
          path: filePathSchema,
          viewed: z.literal(false),
        })
        .strict(),
    ]),
    output: z.object({ ok: z.literal(true) }).strict(),
    experimental_changes: (input) => [
      { entity: "viewed", id: input.environmentId, changes: ["changed"] },
    ],
  },
  context: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z
      .object({
        environment: environmentSchema.nullable(),
        archivedAt: z.number().nullable(),
      })
      .strict(),
    experimental_dependencies: (input, output) => [
      { entity: "thread", id: input.threadId, changes: ["changed"] },
      ...(output.environment === null
        ? []
        : [
            {
              entity: "environment",
              id: output.environment.id,
              changes: ["changed"],
            },
          ]),
    ],
  },
  branches: {
    input: z
      .object({
        environmentId: z.string().min(1),
        query: z.string(),
        selectedBranch: gitBranchNameSchema.nullable(),
        limit: z.number().int().positive().max(200),
      })
      .strict(),
    output: gitBranchOptionsSchema,
    experimental_dependencies: gitDependencies,
  },
  status: {
    input: status,
    output: environmentStatusResponseSchema,
    experimental_dependencies: gitDependencies,
  },
  files: {
    input: files,
    output: environmentDiffFilesResponseSchema,
    experimental_dependencies: gitDependencies,
  },
  diff: {
    input: z
      .object({
        environmentId: z.string().min(1),
        target,
        purpose: z.enum(["display", "commit-message"]).default("display"),
      })
      .strict(),
    output: environmentDiffResponseSchema,
    experimental_dependencies: gitDependencies,
  },
});
