import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { proposalSchema } from "./proposals.js";

export const MAX_TREE_ENTRIES = 5_000;

export const VAULTS_TAG = "vaults";
export const vaultTag = (vaultId: string) => `vault:${vaultId}`;
export const treeTag = (vaultId: string) => `tree:${vaultId}`;
export const documentTag = (vaultId: string, path: string) =>
  `doc:${vaultId}:${path}`;
export const folderTag = (vaultId: string, path: string) =>
  `folder:${vaultId}:${path}`;

export function documentTags(vaultId: string, path: string): string[] {
  const parts = path.split("/");
  return [
    vaultTag(vaultId),
    documentTag(vaultId, path),
    ...parts
      .slice(0, -1)
      .map((_, index) =>
        folderTag(vaultId, parts.slice(0, index + 1).join("/")),
      ),
  ];
}

export function pathTags(vaultId: string, path: string): string[] {
  return [documentTag(vaultId, path), folderTag(vaultId, path)];
}

export function openedFileTag(source: OpenerSource, path: string): string {
  return `opened:${JSON.stringify([
    source.kind,
    source.threadId,
    source.environmentId,
    source.projectId,
    source.experimental_hostId ?? null,
    path,
  ])}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value.trim();
}

export function requireVaultPath(
  value: unknown,
  options?: { extension?: string },
): string {
  const raw = requireString(value, "path").replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw) || raw.includes("\0")) {
    throw new Error(`Invalid vault path: ${raw}`);
  }
  const segments = raw.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("."),
    )
  ) {
    throw new Error(`Invalid vault path: ${raw}`);
  }
  if (options?.extension && !raw.toLowerCase().endsWith(options.extension)) {
    throw new Error(`Path must end with ${options.extension}: ${raw}`);
  }
  return raw;
}

export const vaultIdSchema = z.string().min(1).optional();
export const vaultSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    hostId: z.string().min(1).nullable(),
    rootPath: z.string().min(1),
  })
  .strict();
export const vaultPathSchema = z.string().transform((value, context) => {
  try {
    return requireVaultPath(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: errorMessage(error),
    });
    return z.NEVER;
  }
});
export const vaultDirectorySchema = z
  .union([z.literal(""), vaultPathSchema])
  .optional();
export const openerSourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    experimental_hostId: z.string().min(1).optional(),
  })
  .strict();
export const fileReadSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    contentEncoding: z.enum(["base64", "utf8"]),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtMs: z.number().nonnegative().optional(),
    sha256: z.string(),
  })
  .strict();
export const fileWriteSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("written"),
      sha256: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("conflict"),
      currentSha256: z.string().nullable(),
    })
    .strict(),
]);
export const previewSchema = z
  .object({
    baseUrl: z.string().min(1),
    expiresAtMs: z.number().nonnegative(),
  })
  .strict();
export const hostSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.enum(["connected", "disconnected"]),
    maxPermissionMode: z.enum(["full", "auto", "accept-edits"]),
    lastSeenAt: z.number().nullable(),
    lastRejectedProtocolVersion: z.number().int().positive().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strip();
export const pathResultSchema = z.object({ path: z.string().min(1) }).strict();
export const okResultSchema = z.object({ ok: z.literal(true) }).strict();
export const syncScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("file"), path: vaultPathSchema }).strict(),
  z.object({ kind: z.literal("folder"), path: vaultPathSchema }).strict(),
]);
export const syncStateEntrySchema = z
  .object({
    remotePath: vaultPathSchema,
    localPath: vaultPathSchema,
    sha256: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    contentEncoding: z.enum(["base64", "utf8"]),
    mimeType: z.string().nullable(),
    modifiedAtMs: z.number().nonnegative().nullable(),
  })
  .strict();
export const syncSnapshotEntrySchema = syncStateEntrySchema.extend({
  content: z.string(),
});
export const syncWriteSchema = z
  .object({
    path: vaultPathSchema,
    content: z.string(),
    contentEncoding: z.enum(["base64", "utf8"]),
    expectedSha256: z.string().nullable(),
  })
  .strict();
export const syncDeleteSchema = z
  .object({ path: vaultPathSchema, expectedSha256: z.string().min(1) })
  .strict();

export type Vault = z.infer<typeof vaultSchema>;
export type OpenerSource = z.infer<typeof openerSourceSchema>;

export const docsRpcContract = defineRpcContract({
  readProposal: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: proposalSchema.nullable(),
  },
  proposeNote: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        content: z.string(),
        expectedSha256: z.string().min(1),
        expectedVersion: z.number().int().positive().nullable(),
      })
      .strict(),
    output: proposalSchema,
  },
  updateProposal: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        content: z.string(),
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
    output: proposalSchema,
  },
  resolveProposal: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        action: z.enum(["accept", "reject", "undo", "redo"]),
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
    output: proposalSchema,
  },
  syncSnapshot: {
    input: z
      .object({ vaultId: vaultIdSchema, scope: syncScopeSchema })
      .strict(),
    output: z
      .object({
        vault: vaultSchema,
        scope: syncScopeSchema,
        files: z.array(syncSnapshotEntrySchema),
        directories: z.array(vaultPathSchema),
      })
      .strict(),
  },
  syncApply: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        writes: z.array(syncWriteSchema).max(MAX_TREE_ENTRIES),
        deletes: z.array(syncDeleteSchema).max(MAX_TREE_ENTRIES),
        directories: z.array(vaultPathSchema).max(MAX_TREE_ENTRIES),
        deleteDirectories: z.array(vaultPathSchema).max(MAX_TREE_ENTRIES),
        dryRun: z.boolean(),
      })
      .strict(),
    output: z
      .object({
        outcome: z.enum(["applied", "conflict", "partial"]),
        written: z.array(syncStateEntrySchema),
        deleted: z.array(vaultPathSchema),
        createdDirectories: z.array(vaultPathSchema),
        deletedDirectories: z.array(vaultPathSchema),
        conflicts: z.array(
          z
            .object({
              path: vaultPathSchema,
              expectedSha256: z.string().nullable(),
              currentSha256: z.string().nullable(),
            })
            .strict(),
        ),
        errors: z.array(
          z.object({ path: z.string(), message: z.string() }).strict(),
        ),
      })
      .strict(),
  },
  listNotes: {
    input: z.object({ vaultId: vaultIdSchema }).strict(),
    output: z
      .object({
        vaults: z.array(vaultSchema),
        vault: vaultSchema,
        hosts: z.array(hostSchema),
        entries: z.array(
          z
            .object({
              kind: z.enum(["file", "directory"]),
              path: z.string(),
            })
            .strict(),
        ),
        entryOrder: z.array(z.string()),
        notes: z.array(
          z
            .object({
              path: z.string(),
              title: z.string(),
              preview: z.string(),
              modifiedAtMs: z.number().nonnegative(),
            })
            .strict(),
        ),
        truncated: z.boolean(),
        error: z.string().nullable(),
      })
      .strict(),
    tags: (_input, output) => [
      VAULTS_TAG,
      vaultTag(output.vault.id),
      treeTag(output.vault.id),
    ],
  },
  readNote: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: fileReadSchema,
  },
  readDocument: {
    input: z
      .object({ vaultId: z.string().min(1), path: vaultPathSchema })
      .strict(),
    output: z
      .object({
        vaultId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        sha256: z.string(),
        proposal: proposalSchema.nullable(),
        preview: previewSchema,
      })
      .strict(),
    tags: (_input, output) => documentTags(output.vaultId, output.path),
  },
  saveDocument: {
    input: z
      .object({
        vaultId: z.string().min(1),
        path: vaultPathSchema,
        content: z.string(),
        expectedSha256: z.string().min(1),
        renameToTitle: z.boolean(),
      })
      .strict(),
    output: z.object({ path: z.string().min(1), sha256: z.string() }).strict(),
  },
  saveNote: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        content: z.string(),
        expectedSha256: z.string().nullable().optional(),
      })
      .strict(),
    output: fileWriteSchema,
  },
  createNote: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        parent: vaultDirectorySchema,
        name: z.string().optional(),
        content: z.string().optional(),
      })
      .strict(),
    output: pathResultSchema,
  },
  deletePath: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        recursive: z.boolean().optional(),
      })
      .strict(),
    output: okResultSchema,
  },
  createFolder: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: pathResultSchema,
  },
  reorderFiles: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        parent: vaultDirectorySchema,
        paths: z.array(vaultPathSchema),
      })
      .strict(),
    output: z.object({ paths: z.array(vaultPathSchema) }).strict(),
  },
  movePath: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        from: vaultPathSchema,
        to: vaultPathSchema,
      })
      .strict(),
    output: pathResultSchema,
  },
  createVault: {
    input: z
      .object({
        name: z.string().min(1),
        rootPath: z.string().min(1),
        hostId: z.string().min(1).optional(),
      })
      .strict(),
    output: vaultSchema,
  },
  removeVault: {
    input: z.object({ vaultId: z.string().min(1) }).strict(),
    output: okResultSchema,
  },
  uploadAttachment: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        notePath: vaultPathSchema,
        content: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    output: z
      .object({
        path: z.string().min(1),
        markdownPath: z.string().min(1),
        result: fileWriteSchema,
      })
      .strict(),
  },
  preparePreview: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: previewSchema,
    tags: (input) =>
      input.vaultId === undefined
        ? []
        : documentTags(input.vaultId, input.path),
  },
  openFile: {
    input: z
      .object({ source: openerSourceSchema, path: z.string().min(1) })
      .strict(),
    output: z
      .object({
        file: fileReadSchema,
        preview: previewSchema,
        previewPath: z.string(),
      })
      .strict(),
    tags: (input) => [openedFileTag(input.source, input.path)],
  },
  saveOpenedFile: {
    input: z
      .object({
        source: openerSourceSchema,
        path: z.string().min(1),
        content: z.string(),
        expectedSha256: z.string().nullable().optional(),
      })
      .strict(),
    output: fileWriteSchema,
  },
});
