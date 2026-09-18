import { createCipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projects,
  appSettingsValues,
  environmentVariables,
  createConnection,
  migrate,
} from "@bb/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  setMachineEnvironmentVariable,
  deleteMachineEnvironmentVariable,
  decryptMachineEnvironment,
  readMachineEnvironment,
  replaceMachineEnvironment,
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
  const persisted = db.select().from(environmentVariables).all();
  expect(JSON.stringify(persisted)).not.toContain("private-");
  expect(
    (await stat(join(dataDir, "machine-environment-key"))).mode & 0o777,
  ).toBe(0o600);
  db.$client.close();
  db = createConnection(":memory:");
  migrate(db);
  db.insert(environmentVariables).values(persisted).run();
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
  await replaceMachineEnvironment(db, dataDir, {
    variables: [{ name: "TOKEN", value: "private", note: null }],
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
  await replaceMachineEnvironment(db, dataDir, {
    variables: [{ name: "TOKEN", value: "private", note: null }],
  });
  const before = db.select().from(environmentVariables).all();
  await rm(join(dataDir, "machine-environment-key"));
  await expect(
    replaceMachineEnvironment(db, dataDir, {
      variables: [
        { name: "TOKEN", value: null, note: null },
        { name: "OTHER", value: "new", note: null },
      ],
    }),
  ).rejects.toThrow("encryption key is unavailable");
  expect(db.select().from(environmentVariables).all()).toEqual(before);
  await expect(
    readFile(join(dataDir, "machine-environment-key")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("serializes replacement and removal without resurrecting values", async () => {
  await replaceMachineEnvironment(db, dataDir, {
    variables: [{ name: "TOKEN", value: "old", note: null }],
  });
  await Promise.all([
    readMachineEnvironment(db),
    replaceMachineEnvironment(db, dataDir, {
      variables: [{ name: "TOKEN", value: "new", note: null }],
    }),
    replaceMachineEnvironment(db, dataDir, { variables: [] }),
  ]);
  expect(readMachineEnvironment(db)).toEqual([]);
});

it("isolates scopes, authenticates scope, and preserves concurrent edits", async () => {
  db.insert(projects)
    .values(
      ["a", "b"].map((id) => ({ id, name: id, createdAt: 1, updatedAt: 1 })),
    )
    .run();
  await setMachineEnvironmentVariable(
    db,
    dataDir,
    { name: "TOKEN", value: "global", note: null },
    null,
  );
  await Promise.all([
    setMachineEnvironmentVariable(
      db,
      dataDir,
      { name: "TOKEN", value: "project-a", note: null },
      "a",
    ),
    setMachineEnvironmentVariable(
      db,
      dataDir,
      { name: "OTHER", value: "other", note: null },
      "a",
    ),
    setMachineEnvironmentVariable(
      db,
      dataDir,
      { name: "TOKEN", value: "", note: null },
      "b",
    ),
  ]);
  const a = readMachineEnvironment(db, "a");
  expect(a.map((row) => row.name)).toEqual(["OTHER", "TOKEN"]);
  expect(await decryptMachineEnvironment(dataDir, a[1]!)).toBe("project-a");
  expect(
    await decryptMachineEnvironment(
      dataDir,
      readMachineEnvironment(db, "b")[0]!,
    ),
  ).toBe("");
  await expect(
    decryptMachineEnvironment(dataDir, { ...a[1]!, projectId: "b" }),
  ).rejects.toThrow("cannot be decrypted");
  await deleteMachineEnvironmentVariable(db, "TOKEN", "a");
  expect(readMachineEnvironment(db, "a").map((row) => row.name)).toEqual([
    "OTHER",
  ]);
  expect(
    await decryptMachineEnvironment(dataDir, readMachineEnvironment(db)[0]!),
  ).toBe("global");
  db.delete(projects).where(eq(projects.id, "a")).run();
  expect(readMachineEnvironment(db, "a")).toEqual([]);
  expect(readMachineEnvironment(db, "b")).toHaveLength(1);
  const global = readMachineEnvironment(db)[0]!;
  expect(() =>
    db
      .insert(environmentVariables)
      .values({ ...global, updatedAt: 1 })
      .run(),
  ).toThrow();
});

it("does not create a new key for an empty scope when another scope still has ciphertext", async () => {
  db.insert(projects)
    .values({ id: "a", name: "A", createdAt: 1, updatedAt: 1 })
    .run();
  await setMachineEnvironmentVariable(
    db,
    dataDir,
    { name: "TOKEN", value: "secret", note: null },
    "a",
  );
  await rm(join(dataDir, "machine-environment-key"));
  await expect(
    setMachineEnvironmentVariable(
      db,
      dataDir,
      { name: "GLOBAL", value: "value", note: null },
      null,
    ),
  ).rejects.toThrow("encryption key is unavailable");
  expect(readMachineEnvironment(db)).toEqual([]);
});

it("migrates legacy settings without changing ciphertext or requiring its key", async () => {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("TOKEN"));
  const encrypted = Buffer.concat([
    cipher.update("legacy-secret", "utf8"),
    cipher.final(),
  ]);
  const ciphertext = Buffer.concat([
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]).toString("base64");
  db.insert(appSettingsValues)
    .values({
      key: "machineEnvironment:TOKEN",
      value: JSON.stringify({
        version: 1,
        name: "TOKEN",
        ciphertext,
        note: "Legacy",
      }),
      updatedAt: 7,
    })
    .run();
  db.$client.exec("DROP TABLE environment_variables");
  const sql = await readFile(
    new URL(
      "../../../../../packages/db/drizzle/0123_cheerful_tomorrow_man.sql",
      import.meta.url,
    ),
    "utf8",
  );
  db.$client.exec(sql);
  expect(
    db
      .select()
      .from(appSettingsValues)
      .all()
      .some((row) => row.key.startsWith("machineEnvironment:")),
  ).toBe(false);
  expect(readMachineEnvironment(db)[0]).toMatchObject({
    ciphertext,
    encryptionVersion: 1,
    projectId: null,
    note: "Legacy",
  });
  await writeFile(
    join(dataDir, "machine-environment-key"),
    key.toString("hex"),
    { mode: 0o600 },
  );
  expect(
    await decryptMachineEnvironment(dataDir, readMachineEnvironment(db)[0]!),
  ).toBe("legacy-secret");
  await replaceMachineEnvironment(db, dataDir, {
    variables: [{ name: "TOKEN", value: null, note: "Retained" }],
  });
  expect(readMachineEnvironment(db)[0]?.ciphertext).toBe(ciphertext);
  await setMachineEnvironmentVariable(
    db,
    dataDir,
    { name: "TOKEN", value: "updated", note: null },
    null,
  );
  expect(readMachineEnvironment(db)[0]?.encryptionVersion).toBe(2);
});
