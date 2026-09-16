import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lastServerMoveSchema } from "@bb/domain";
import { serverMoveBindHostSchema } from "@bb/host-daemon-contract";
import { z } from "zod";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import { isFileNotFoundError, writeFileAtomically } from "./fs.js";

export const SERVER_MOVE_INCOMING_DIR_NAME = "server-move-incoming";
const INCOMING_MOVE_STATE_FILE_NAME = "state.json";
const MOVE_ID_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export const activationPlanKindSchema = z.enum([
  "launcher",
  "service",
  "replacement",
]);
export type ActivationPlanKind = z.infer<typeof activationPlanKindSchema>;

const incomingMoveStateSchema = z
  .object({
    version: z.literal(1),
    moveId: z.string().regex(MOVE_ID_SEGMENT_PATTERN),
    activationToken: z.string().min(16),
    serverPort: z.number().int().min(1).max(65_535),
    bindHost: serverMoveBindHostSchema.nullable(),
    importedEntries: z.array(z.string().min(1)).nullable(),
    archivedServerData: z
      .object({
        originalPath: z.string().min(1),
        archivedPath: z.string().min(1),
      })
      .strict()
      .nullable(),
    pendingServer: z
      .object({
        pid: z.number().int().positive(),
        localServerUrl: z.string().min(1),
      })
      .strict()
      .nullable(),
    preparedAt: z.number().int().nonnegative().nullable(),
    activation: z
      .object({
        lastMove: lastServerMoveSchema,
        plan: activationPlanKindSchema,
        requestedAt: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type IncomingMoveState = z.infer<typeof incomingMoveStateSchema>;

export function requireMoveIdSegment(moveId: string): string {
  if (!MOVE_ID_SEGMENT_PATTERN.test(moveId)) {
    throw new ExpectedCommandDispatchError(
      "invalid_command",
      `Invalid server move id: ${JSON.stringify(moveId)}`,
    );
  }
  return moveId;
}

export function incomingMovesRoot(dataDir: string): string {
  return join(dataDir, SERVER_MOVE_INCOMING_DIR_NAME);
}

export function incomingMoveDir(dataDir: string, moveId: string): string {
  return join(incomingMovesRoot(dataDir), moveId);
}

export async function readIncomingMoveState(
  dataDir: string,
  moveId: string,
): Promise<IncomingMoveState | null> {
  let raw: string;
  try {
    raw = await readFile(
      join(incomingMoveDir(dataDir, moveId), INCOMING_MOVE_STATE_FILE_NAME),
      "utf8",
    );
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  return incomingMoveStateSchema.parse(JSON.parse(raw));
}

export async function writeIncomingMoveState(
  dataDir: string,
  state: IncomingMoveState,
): Promise<void> {
  await writeFileAtomically({
    path: join(
      incomingMoveDir(dataDir, state.moveId),
      INCOMING_MOVE_STATE_FILE_NAME,
    ),
    content: `${JSON.stringify(incomingMoveStateSchema.parse(state), null, 2)}\n`,
    mode: 0o600,
  });
}

export async function listIncomingMoveIds(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(incomingMovesRoot(dataDir), {
      withFileTypes: true,
    });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && MOVE_ID_SEGMENT_PATTERN.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}
