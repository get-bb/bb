import { rm } from "node:fs/promises";
import { join } from "node:path";
import { serverMoveStatusSchema } from "@bb/server-contract";
import { z } from "zod";
import { readOptionalText, writeTextAtomically } from "./managed-files.js";

export const SERVER_MOVE_RUN_FILE_NAME = "server-move-run.json";

const timestampSchema = z.number().int().nonnegative();

export const serverMoveRunFileSchema = z
  .object({
    version: z.literal(1),
    status: serverMoveStatusSchema,
    activationToken: z.string().min(1),
    archiveExistingTargetServerData: z.boolean(),
    sourceServerHost: z
      .object({ id: z.string().min(1), name: z.string().min(1) })
      .strict(),
    connectHandle: z.string().min(1).nullable(),
    workDir: z.string().min(1),
    grant: z
      .object({
        serverUrl: z.string().min(1),
        headers: z.record(z.string(), z.string()),
      })
      .strict()
      .nullable(),
    configBackup: z
      .object({
        path: z.string().min(1),
        originalText: z.string().nullable(),
      })
      .strict()
      .nullable(),
    movedAt: timestampSchema.nullable(),
    activationRequestedAt: timestampSchema.nullable(),
    activationConfirmedAt: timestampSchema.nullable(),
  })
  .strict();
export type ServerMoveRunFile = z.infer<typeof serverMoveRunFileSchema>;

function runFilePath(dataDir: string): string {
  return join(dataDir, SERVER_MOVE_RUN_FILE_NAME);
}

export async function readServerMoveRunFile(
  dataDir: string,
): Promise<ServerMoveRunFile | null> {
  const path = runFilePath(dataDir);
  const text = await readOptionalText(path);
  if (text === null) {
    return null;
  }
  return serverMoveRunFileSchema.parse(JSON.parse(text));
}

export async function writeServerMoveRunFile(
  dataDir: string,
  file: ServerMoveRunFile,
): Promise<void> {
  await writeTextAtomically(
    runFilePath(dataDir),
    `${JSON.stringify(serverMoveRunFileSchema.parse(file), null, 2)}\n`,
  );
}

export async function removeServerMoveRunFile(dataDir: string): Promise<void> {
  await rm(runFilePath(dataDir), { force: true });
}
