import { ApiError } from "../../errors.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  environmentVariables,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import {
  machineEnvironmentNameSchema,
  type MachineEnvironmentReplace,
  type MachineEnvironmentSet,
} from "@bb/server-contract";
import { runSerialized } from "../lib/async-deduper.js";

const keyFile = "machine-environment-key";
const encryptedSchema = z.object({
  encryptionVersion: z.union([z.literal(1), z.literal(2)]),
  projectId: z.string().nullable(),
  name: machineEnvironmentNameSchema,
  ciphertext: z.string(),
  note: z.string().nullable(),
});
type EncryptedVariable = z.infer<typeof encryptedSchema>;
const locks = new WeakMap<DbConnection, Promise<unknown>>();

function scope(projectId: string | null) {
  return projectId === null
    ? isNull(environmentVariables.projectId)
    : eq(environmentVariables.projectId, projectId);
}

async function encryptionKey(dataDir: string, allowCreate: boolean) {
  try {
    const value = allowCreate
      ? await readOrCreateSecretFile({
          dataDir,
          fileName: keyFile,
          bytes: 32,
          encoding: "hex",
        })
      : (await readFile(join(dataDir, keyFile), "utf8")).trim();
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Invalid key");
    return Buffer.from(value, "hex");
  } catch {
    throw new Error(
      "Machine environment encryption key is unavailable; restore it from backup.",
    );
  }
}

function associatedData(
  row: Pick<EncryptedVariable, "encryptionVersion" | "projectId" | "name">,
) {
  return Buffer.from(
    row.encryptionVersion === 1
      ? row.name
      : JSON.stringify([row.projectId, row.name]),
  );
}

function encrypt(
  key: Buffer,
  input: MachineEnvironmentSet,
  projectId: string | null,
): EncryptedVariable {
  const row = { ...input, projectId, encryptionVersion: 2 as const };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(row));
  const encrypted = Buffer.concat([
    cipher.update(input.value, "utf8"),
    cipher.final(),
  ]);
  return {
    encryptionVersion: row.encryptionVersion,
    projectId,
    name: input.name,
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    ),
    note: input.note,
  };
}

export async function decryptMachineEnvironment(
  dataDir: string,
  row: EncryptedVariable,
): Promise<string> {
  const key = await encryptionKey(dataDir, false);
  try {
    if (row.encryptionVersion === 1 && row.projectId !== null)
      throw new Error("Invalid legacy scope");
    const encrypted = Buffer.from(row.ciphertext, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      encrypted.subarray(0, 12),
    );
    cipher.setAAD(associatedData(row));
    cipher.setAuthTag(encrypted.subarray(12, 28));
    return Buffer.concat([
      cipher.update(encrypted.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      `Machine environment variable ${row.name} cannot be decrypted; restore its encryption key or set it again.`,
    );
  }
}

function save(db: DbQueryConnection, row: EncryptedVariable) {
  db.delete(environmentVariables)
    .where(and(scope(row.projectId), eq(environmentVariables.name, row.name)))
    .run();
  db.insert(environmentVariables)
    .values({ ...row, updatedAt: Date.now() })
    .run();
}

export function readMachineEnvironment(
  db: DbConnection,
  projectId: string | null = null,
): EncryptedVariable[] {
  return db
    .select()
    .from(environmentVariables)
    .where(scope(projectId))
    .orderBy(environmentVariables.name)
    .all()
    .map((row) => encryptedSchema.parse(row));
}

async function keyForWrite(db: DbConnection, dataDir: string) {
  const existing = db
    .select({ id: environmentVariables.id })
    .from(environmentVariables)
    .limit(1)
    .get();
  return encryptionKey(dataDir, existing === undefined);
}

export function replaceMachineEnvironment(
  db: DbConnection,
  dataDir: string,
  input: MachineEnvironmentReplace,
  projectId: string | null = null,
): Promise<void> {
  return runSerialized(locks, db, async () => {
    const currentByName = new Map(
      readMachineEnvironment(db, projectId).map((row) => [row.name, row]),
    );
    const key = input.variables.some((variable) => variable.value !== null)
      ? await keyForWrite(db, dataDir)
      : null;
    const replacements = input.variables.map((variable) => {
      if (variable.value !== null) {
        if (key === null) throw new Error("Missing machine environment key");
        return encrypt(key, { ...variable, value: variable.value }, projectId);
      }
      const existing = currentByName.get(variable.name);
      if (!existing)
        throw new ApiError(
          409,
          "invalid_request",
          `No saved value for ${variable.name}; reload settings and retry`,
        );
      return { ...existing, note: variable.note };
    });
    db.transaction((tx) => {
      tx.delete(environmentVariables).where(scope(projectId)).run();
      for (const row of replacements) save(tx, row);
    });
  });
}

export function setMachineEnvironmentVariable(
  db: DbConnection,
  dataDir: string,
  input: MachineEnvironmentSet,
  projectId: string | null,
): Promise<void> {
  return runSerialized(locks, db, async () => {
    const row = encrypt(await keyForWrite(db, dataDir), input, projectId);
    db.transaction((tx) => save(tx, row));
  });
}

export function deleteMachineEnvironmentVariable(
  db: DbConnection,
  name: string,
  projectId: string | null,
): Promise<void> {
  return runSerialized(locks, db, async () => {
    db.delete(environmentVariables)
      .where(and(scope(projectId), eq(environmentVariables.name, name)))
      .run();
  });
}
