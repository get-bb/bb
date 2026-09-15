import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { lastServerMoveSchema, serverMoveModeSchema } from "@bb/domain";
import { z } from "zod";
import { hasErrorCode } from "./errors.js";
import { readJsonFile, writeJsonFileAtomically } from "./json-file.js";
import { isServerOwnedPath } from "./server-owned-paths.js";

export const SERVER_MOVED_FILE_NAME = "server-moved.json";
export const SERVER_IMPORT_FILE_NAME = "server-import.json";
export const SERVER_IMPORT_JOURNAL_FILE_NAME = "server-import-journal.json";
export const LAST_SERVER_MOVE_FILE_NAME = "last-server-move.json";
export const SERVER_CONNECT_HOLD_FILE_NAME = "server-connect-hold.json";

const identifierSchema = z.string().min(1);
const timestampSchema = z.number().int().nonnegative();
const serverOwnedPathSchema = z.string().refine(isServerOwnedPath, {
  message: "Expected a server-owned path relative to the data directory",
});

export const serverMovedFileSchema = z
  .object({
    version: z.literal(1),
    moveId: identifierSchema,
    movedAt: timestampSchema,
    fromHostId: identifierSchema,
    toHostId: identifierSchema,
    toHostName: identifierSchema,
    serverUrl: z.string().min(1),
    mode: serverMoveModeSchema,
    connectHandle: z.string().min(1).nullable(),
    oldCopyEntries: z.array(serverOwnedPathSchema),
  })
  .strict();
export type ServerMovedFile = z.infer<typeof serverMovedFileSchema>;

export const serverImportKindSchema = z.enum(["move", "manual"]);
export type ServerImportKind = z.infer<typeof serverImportKindSchema>;

export const serverImportFileSchema = z
  .object({
    version: z.literal(1),
    kind: serverImportKindSchema,
    moveId: identifierSchema.nullable(),
    activationToken: z.string().min(1).nullable(),
    sourceDataDir: z.string().min(1),
    sourceServerHostId: identifierSchema.nullable(),
    targetHostId: identifierSchema.nullable(),
    serverUrl: z.string().min(1).nullable(),
    importedEntries: z.array(serverOwnedPathSchema),
    createdAt: timestampSchema,
    fixupsAppliedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((file, context) => {
    if (file.kind !== "move") {
      return;
    }
    if (file.moveId === null) {
      context.addIssue({
        code: "custom",
        message: "A move import requires a moveId",
        path: ["moveId"],
      });
    }
    if (file.activationToken === null) {
      context.addIssue({
        code: "custom",
        message: "A move import requires an activationToken",
        path: ["activationToken"],
      });
    }
  });
export type ServerImportFile = z.infer<typeof serverImportFileSchema>;

export const serverImportJournalFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(serverOwnedPathSchema),
    preexistingEntries: z.array(serverOwnedPathSchema),
  })
  .strict();
export type ServerImportJournalFile = z.infer<
  typeof serverImportJournalFileSchema
>;

export const lastServerMoveFileSchema = lastServerMoveSchema
  .extend({ version: z.literal(1) })
  .strict();
export type LastServerMoveFile = z.infer<typeof lastServerMoveFileSchema>;

export const serverConnectHoldFileSchema = z
  .object({
    version: z.literal(1),
    reason: z.literal("manual-import"),
    createdAt: timestampSchema,
  })
  .strict();
export type ServerConnectHoldFile = z.infer<typeof serverConnectHoldFileSchema>;

export function readServerMovedFile(
  dataDir: string,
): Promise<ServerMovedFile | null> {
  return readJsonFile(
    join(dataDir, SERVER_MOVED_FILE_NAME),
    serverMovedFileSchema,
  );
}

export async function writeServerMovedFile(
  dataDir: string,
  file: ServerMovedFile,
): Promise<void> {
  await writeJsonFileAtomically(
    join(dataDir, SERVER_MOVED_FILE_NAME),
    serverMovedFileSchema.parse(file),
  );
}

export function readServerImportFile(
  dataDir: string,
): Promise<ServerImportFile | null> {
  return readJsonFile(
    join(dataDir, SERVER_IMPORT_FILE_NAME),
    serverImportFileSchema,
  );
}

export async function writeServerImportFile(
  dataDir: string,
  file: ServerImportFile,
): Promise<void> {
  await writeJsonFileAtomically(
    join(dataDir, SERVER_IMPORT_FILE_NAME),
    serverImportFileSchema.parse(file),
  );
}

export function readServerImportJournalFile(
  dataDir: string,
): Promise<ServerImportJournalFile | null> {
  return readJsonFile(
    join(dataDir, SERVER_IMPORT_JOURNAL_FILE_NAME),
    serverImportJournalFileSchema,
  );
}

export async function writeServerImportJournalFile(
  dataDir: string,
  file: ServerImportJournalFile,
): Promise<void> {
  await writeJsonFileAtomically(
    join(dataDir, SERVER_IMPORT_JOURNAL_FILE_NAME),
    serverImportJournalFileSchema.parse(file),
  );
}

export async function removeServerImportJournalFile(
  dataDir: string,
): Promise<void> {
  await rm(join(dataDir, SERVER_IMPORT_JOURNAL_FILE_NAME), { force: true });
}

export function readLastServerMoveFile(
  dataDir: string,
): Promise<LastServerMoveFile | null> {
  return readJsonFile(
    join(dataDir, LAST_SERVER_MOVE_FILE_NAME),
    lastServerMoveFileSchema,
  );
}

export async function writeLastServerMoveFile(
  dataDir: string,
  file: LastServerMoveFile,
): Promise<void> {
  await writeJsonFileAtomically(
    join(dataDir, LAST_SERVER_MOVE_FILE_NAME),
    lastServerMoveFileSchema.parse(file),
  );
}

export function readServerConnectHoldFile(
  dataDir: string,
): Promise<ServerConnectHoldFile | null> {
  return readJsonFile(
    join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME),
    serverConnectHoldFileSchema,
  );
}

export async function writeServerConnectHoldFile(
  dataDir: string,
  file: ServerConnectHoldFile,
): Promise<void> {
  await writeJsonFileAtomically(
    join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME),
    serverConnectHoldFileSchema.parse(file),
  );
}

export async function removeServerConnectHoldFile(
  dataDir: string,
): Promise<boolean> {
  try {
    await unlink(join(dataDir, SERVER_CONNECT_HOLD_FILE_NAME));
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}
