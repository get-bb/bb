import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
import { z } from "zod";
import { appSettingsValues, type DbConnection } from "@bb/db";
import { deleteSecretFile, readOrCreateSecretFile } from "@bb/secret-storage";
import {
  machineEnvironmentNameSchema,
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
const legacySchema = z
  .object({
    name: machineEnvironmentNameSchema,
    value: z.string().nullable(),
    secret: z.boolean(),
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

function legacyPath(dataDir: string, name: string) {
  return join(
    dataDir,
    "secrets",
    "machine-environment",
    machineEnvironmentNameSchema.parse(name),
  );
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

function save(db: DbConnection, row: EncryptedVariable) {
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

async function migrateLegacy(
  db: DbConnection,
  dataDir: string,
): Promise<EncryptedVariable[]> {
  const rows = records(db).map((row) => {
    const parsed = z
      .union([encryptedSchema, legacySchema])
      .parse(JSON.parse(row.value));
    if (row.key !== prefix + parsed.name)
      throw new Error("Invalid machine environment record");
    return parsed;
  });
  if (!rows.some((row) => !("version" in row))) {
    for (const row of rows)
      await deleteSecretFile(legacyPath(dataDir, row.name));
    return rows.map((row) => encryptedSchema.parse(row));
  }
  const key = await encryptionKey(
    dataDir,
    !rows.some((row) => "version" in row),
  );
  const migrated: EncryptedVariable[] = [];
  for (const row of rows) {
    if ("version" in row) {
      await deleteSecretFile(legacyPath(dataDir, row.name));
      migrated.push(row);
      continue;
    }
    let value = row.value;
    if (row.secret) {
      try {
        value = await readFile(legacyPath(dataDir, row.name), "utf8");
      } catch {
        throw new Error(
          `Machine environment variable ${row.name} is unavailable; restore its legacy secret file or set it again.`,
        );
      }
    }
    if (value === null)
      throw new Error(`Machine environment variable ${row.name} has no value`);
    const encrypted = encrypt(key, { name: row.name, value, note: row.note });
    save(db, encrypted);
    await deleteSecretFile(legacyPath(dataDir, row.name));
    migrated.push(encrypted);
  }
  return migrated;
}

export function readMachineEnvironment(db: DbConnection, dataDir: string) {
  return serialized(db, () => migrateLegacy(db, dataDir));
}

export function updateMachineEnvironment(
  db: DbConnection,
  dataDir: string,
  name: string,
  input: MachineEnvironmentSet | null,
): Promise<void> {
  name = machineEnvironmentNameSchema.parse(name);
  return serialized(db, async () => {
    if (input === null) {
      db.delete(appSettingsValues)
        .where(eq(appSettingsValues.key, prefix + name))
        .run();
    } else {
      const key = await encryptionKey(
        dataDir,
        !records(db).some(
          (row) => encryptedSchema.safeParse(JSON.parse(row.value)).success,
        ),
      );
      save(db, encrypt(key, { ...input, name }));
    }
    await deleteSecretFile(legacyPath(dataDir, name));
  });
}
