import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appSettingsValues, createConnection, migrate } from "@bb/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  decryptMachineEnvironment,
  readMachineEnvironment,
  replaceMachineEnvironment,
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
it("stores encrypted values that survive a database reopen", async () => {
  await replaceMachineEnvironment(db, dataDir, {
    variables: ["REGION", "TOKEN"].map((name) => ({
      name,
      value: "private-" + name,
      note: null,
    })),
  });
  const rows = readMachineEnvironment(db);
  const persisted = db.select().from(appSettingsValues).all();
  expect(JSON.stringify(persisted)).not.toContain("private-");
  expect(
    (await stat(join(dataDir, "machine-environment-key"))).mode & 0o777,
  ).toBe(0o600);
  db.$client.close();
  db = createConnection(":memory:");
  migrate(db);
  db.insert(appSettingsValues).values(persisted).run();
  expect(readMachineEnvironment(db)).toEqual(rows);
  expect(await decryptMachineEnvironment(dataDir, rows[1]!)).toBe(
    "private-TOKEN",
  );
});

it("replaces the whole list while retaining unchanged ciphertext", async () => {
  await replaceMachineEnvironment(db, dataDir, {
    variables: [
      { name: "REMOVE", value: "old", note: null },
      { name: "TOKEN", value: "private", note: null },
    ],
  });
  const token = readMachineEnvironment(db).find((row) => row.name === "TOKEN");
  await replaceMachineEnvironment(db, dataDir, {
    variables: [
      { name: "TOKEN", value: null, note: "Retained" },
      { name: "ADDED", value: "new", note: null },
    ],
  });
  const rows = readMachineEnvironment(db);
  expect(rows.map((row) => row.name)).toEqual(["ADDED", "TOKEN"]);
  expect(rows[1]).toEqual({ ...token, note: "Retained" });
  expect(await decryptMachineEnvironment(dataDir, rows[1]!)).toBe("private");
});

it("authenticates ciphertext and its variable name", async () => {
  await updateMachineEnvironment(db, dataDir, "TOKEN", {
    name: "TOKEN",
    value: "private",
    note: null,
  });
  const [row] = readMachineEnvironment(db);
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

it("serializes replacement and removal without resurrecting values", async () => {
  await updateMachineEnvironment(db, dataDir, "TOKEN", {
    name: "TOKEN",
    value: "old",
    note: null,
  });
  await Promise.all([
    readMachineEnvironment(db),
    updateMachineEnvironment(db, dataDir, "TOKEN", {
      name: "TOKEN",
      value: "new",
      note: null,
    }),
    updateMachineEnvironment(db, dataDir, "TOKEN", null),
  ]);
  expect(readMachineEnvironment(db)).toEqual([]);
});
