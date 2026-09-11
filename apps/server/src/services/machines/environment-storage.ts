import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { like } from "drizzle-orm";
import { z } from "zod";
import {
  appSettingsValues,
  type DbConnection,
  type DbQueryConnection,
} from "@bb/db";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import {
  machineEnvironmentNameSchema,
  type MachineEnvironmentReplace,
  type MachineEnvironmentSet,
} from "@bb/server-contract";

const prefix = "machineEnvironment:";
const keyFile = "machine-environment-key";
const encryptedSchema = z
  .object({
    version: z.literal(1),
    name: machineEnvironmentNameSchema,
    ciphertext: z.string(),
    note: z.string().nullable(),
  })
  .strict();
type EncryptedVariable = z.infer<typeof encryptedSchema>;
const locks = new WeakMap<DbConnection, Promise<unknown>>();

async function serialized<T>(
  db: DbConnection,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(db) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(db, current);
  try {
    return await current;
  } finally {
    if (locks.get(db) === current) locks.delete(db);
  }
}

function records(db: DbConnection) {
  return db
    .select()
    .from(appSettingsValues)
    .where(like(appSettingsValues.key, `${prefix}%`))
    .orderBy(appSettingsValues.key)
    .all();
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

function encrypt(key: Buffer, input: MachineEnvironmentSet): EncryptedVariable {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(input.name));
  const encrypted = Buffer.concat([
    cipher.update(input.value, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
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
    const encrypted = Buffer.from(row.ciphertext, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      encrypted.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(row.name));
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
  const value = JSON.stringify(row);
  const updatedAt = Date.now();
  db.insert(appSettingsValues)
    .values({ key: prefix + row.name, value, updatedAt })
    .onConflictDoUpdate({
      target: appSettingsValues.key,
      set: { value, updatedAt },
    })
    .run();
}

export function readMachineEnvironment(db: DbConnection): EncryptedVariable[] {
  return records(db).map((row) => {
    const parsed = encryptedSchema.parse(JSON.parse(row.value));
    if (row.key !== prefix + parsed.name)
      throw new Error("Invalid machine environment record");
    return parsed;
  });
}

async function replaceRows(
  db: DbConnection,
  dataDir: string,
  variables: MachineEnvironmentReplace["variables"],
): Promise<void> {
  const current = readMachineEnvironment(db);
  const currentByName = new Map(current.map((row) => [row.name, row]));
  const needsEncryption = variables.some((variable) => variable.value !== null);
  const key = needsEncryption
    ? await encryptionKey(dataDir, current.length === 0)
    : null;
  const replacements = variables.flatMap((variable) => {
    if (variable.value !== null) {
      if (key === null) throw new Error("Missing machine environment key");
      return [encrypt(key, { ...variable, value: variable.value })];
    }
    const existing = currentByName.get(variable.name);
    return existing === undefined ? [] : [{ ...existing, note: variable.note }];
  });
  db.transaction((tx) => {
    tx.delete(appSettingsValues)
      .where(like(appSettingsValues.key, `${prefix}%`))
      .run();
    for (const row of replacements) save(tx, row);
  });
}

export function replaceMachineEnvironment(
  db: DbConnection,
  dataDir: string,
  input: MachineEnvironmentReplace,
): Promise<void> {
  return serialized(db, () => replaceRows(db, dataDir, input.variables));
}

export function updateMachineEnvironment(
  db: DbConnection,
  dataDir: string,
  name: string,
  input: MachineEnvironmentSet | null,
): Promise<void> {
  name = machineEnvironmentNameSchema.parse(name);
  return serialized(db, async () => {
    const variables: MachineEnvironmentReplace["variables"] =
      readMachineEnvironment(db)
        .filter((row) => row.name !== name)
        .map((row) => ({ name: row.name, value: null, note: row.note }));
    if (input !== null) variables.push({ ...input, name });
    await replaceRows(db, dataDir, variables);
  });
}
