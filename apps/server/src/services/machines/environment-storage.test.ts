import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appSettingsValues, createConnection, migrate } from "@bb/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  decryptMachineEnvironment,
  readMachineEnvironment,
  updateMachineEnvironment,
} from "./environment-storage.js";

let db: ReturnType<typeof createConnection>;
let dataDir: string;
beforeEach(async () => {
  db = createConnection(":memory:");
  migrate(db);
  dataDir = await mkdtemp(join(tmpdir(), "bb-env-encryption-"));
});
afterEach(async () => {
  db.$client.close();
  await rm(dataDir, { recursive: true, force: true });
});
function seed(name: string, value: string | null, secret: boolean) {
  db.insert(appSettingsValues)
    .values({
      key: `machineEnvironment:${name}`,
      value: JSON.stringify({ name, value, secret, note: null }),
      updatedAt: 1,
    })
    .run();
}

it("migrates plaintext and private files without changing values, and survives a database reopen", async () => {
  seed("REGION", "old-region", false);
  seed("TOKEN", null, true);
  const oldPath = join(dataDir, "secrets", "machine-environment", "TOKEN");
  await mkdir(join(dataDir, "secrets", "machine-environment"), {
    recursive: true,
  });
  await writeFile(oldPath, "old-token", { mode: 0o600 });
  const rows = await readMachineEnvironment(db, dataDir);
  expect(
    await Promise.all(
      rows.map((row) => decryptMachineEnvironment(dataDir, row)),
    ),
  ).toEqual(["old-region", "old-token"]);
  const persisted = db.select().from(appSettingsValues).all();
  expect(JSON.stringify(persisted)).not.toMatch(/old-region|old-token/);
  await expect(stat(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    (await stat(join(dataDir, "machine-environment-key"))).mode & 0o777,
  ).toBe(0o600);
  db.$client.close();
  db = createConnection(":memory:");
  migrate(db);
  db.insert(appSettingsValues).values(persisted).run();
  expect(await readMachineEnvironment(db, dataDir)).toEqual(rows);
  expect(await decryptMachineEnvironment(dataDir, rows[1]!)).toBe("old-token");
});

it("preserves a missing legacy secret for recovery and allows replacing it", async () => {
  seed("TOKEN", null, true);
  const before = db.select().from(appSettingsValues).all();
  await expect(readMachineEnvironment(db, dataDir)).rejects.toThrow(
    "legacy secret file",
  );
  expect(db.select().from(appSettingsValues).all()).toEqual(before);
  await updateMachineEnvironment(db, dataDir, "TOKEN", {
    name: "TOKEN",
    value: "replacement",
    note: null,
  });
  const [row] = await readMachineEnvironment(db, dataDir);
  expect(await decryptMachineEnvironment(dataDir, row!)).toBe("replacement");
});

it("authenticates ciphertext and its variable name", async () => {
  await updateMachineEnvironment(db, dataDir, "TOKEN", {
    name: "TOKEN",
    value: "private",
    note: null,
  });
  const [row] = await readMachineEnvironment(db, dataDir);
  await expect(
    decryptMachineEnvironment(dataDir, { ...row!, name: "OTHER" }),
  ).rejects.toThrow("cannot be decrypted");
  const bytes = Buffer.from(row!.ciphertext, "base64");
  bytes[28] = bytes[28]! ^ 1;
  await expect(
    decryptMachineEnvironment(dataDir, {
      ...row!,
      ciphertext: bytes.toString("base64"),
    }),
  ).rejects.toThrow("cannot be decrypted");
});

it("does not replace a missing encryption key or overwrite existing ciphertext", async () => {
  await updateMachineEnvironment(db, dataDir, "TOKEN", {
    name: "TOKEN",
    value: "private",
    note: null,
  });
  const before = db.select().from(appSettingsValues).all();
  await rm(join(dataDir, "machine-environment-key"));
  await expect(
    updateMachineEnvironment(db, dataDir, "OTHER", {
      name: "OTHER",
      value: "new",
      note: null,
    }),
  ).rejects.toThrow("encryption key is unavailable");
  expect(db.select().from(appSettingsValues).all()).toEqual(before);
  await expect(
    readFile(join(dataDir, "machine-environment-key")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("serializes migration, replacement and removal without resurrecting old values", async () => {
  seed("TOKEN", "old", false);
  await Promise.all([
    readMachineEnvironment(db, dataDir),
    updateMachineEnvironment(db, dataDir, "TOKEN", {
      name: "TOKEN",
      value: "new",
      note: null,
    }),
    updateMachineEnvironment(db, dataDir, "TOKEN", null),
  ]);
  expect(await readMachineEnvironment(db, dataDir)).toEqual([]);
});
