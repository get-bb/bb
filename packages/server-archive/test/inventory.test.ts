import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listServerOwnedEntries } from "../src/index.js";
import {
  fixtureBody,
  HOST_OWNED_FIXTURE_PATHS,
  SERVER_OWNED_FIXTURE_PATHS,
  writeFixtureFile,
} from "./data-dir-fixtures.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-server-inventory-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

describe("listServerOwnedEntries", () => {
  it("includes server-owned files and excludes host-owned, cache, and unknown entries", async () => {
    const dataDir = await makeTempDir();
    for (const relativePath of [
      ...SERVER_OWNED_FIXTURE_PATHS,
      ...HOST_OWNED_FIXTURE_PATHS,
    ]) {
      await writeFixtureFile(dataDir, relativePath);
    }

    const inventory = await listServerOwnedEntries(dataDir);

    const files = inventory.entries.flatMap((entry) => entry.files);
    expect(files.map((file) => file.path).sort()).toEqual(
      [...SERVER_OWNED_FIXTURE_PATHS].sort(),
    );
    expect(inventory.entries.map((entry) => entry.path)).toEqual([
      "AGENTS.md",
      "attachments",
      "auth-secret",
      "bb.db",
      "config.json",
      "env.json",
      "machine-environment-key",
      "plugins/automations/marketplace.json",
      "plugins/automations/scripts",
      "plugins/cache",
      "plugins/docs/data.db",
      "plugins/docs/secrets",
      "plugins/npm",
      "plugins/snapshots",
      "skills",
      "telemetry-id",
      "theme",
    ]);
    expect(
      files
        .filter((file) => file.sqliteDatabase)
        .map((file) => file.path)
        .sort(),
    ).toEqual(["bb.db", "plugins/docs/data.db"]);
    const database = files.find((file) => file.path === "bb.db");
    expect(database?.absolutePath).toBe(path.join(dataDir, "bb.db"));
    expect(database?.sizeBytes).toBe(fixtureBody("bb.db").length);
    expect(inventory.skippedPaths).toEqual([]);
  });

  it("skips and reports symbolic links and allowlisted files that are directories", async () => {
    const dataDir = await makeTempDir();
    const outside = await makeTempDir();
    await writeFixtureFile(outside, "secret.txt", "x");
    await writeFixtureFile(outside, "vault/notes.md", "x");
    await writeFixtureFile(dataDir, "attachments/real.png", "x");
    await writeFixtureFile(dataDir, "bb.db/nested", "x");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(dataDir, "attachments", "linked.png"),
    );
    await symlink(path.join(outside, "vault"), path.join(dataDir, "skills"));
    await mkdir(path.join(dataDir, "plugins"), { recursive: true });
    await symlink(
      path.join(outside, "vault"),
      path.join(dataDir, "plugins", "dev-plugin"),
    );
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(dataDir, "auth-secret"),
    );

    const inventory = await listServerOwnedEntries(dataDir);

    expect(inventory.entries).toEqual([
      {
        path: "attachments",
        kind: "directory",
        files: [
          {
            path: "attachments/real.png",
            absolutePath: path.join(dataDir, "attachments", "real.png"),
            sizeBytes: 1,
            sqliteDatabase: false,
          },
        ],
      },
    ]);
    expect(inventory.skippedPaths).toEqual([
      "attachments/linked.png",
      "auth-secret",
      "bb.db",
      "plugins/dev-plugin",
      "skills",
    ]);
  });

  it("returns an empty inventory for a daemon-only data directory", async () => {
    const dataDir = await makeTempDir();
    await writeFixtureFile(dataDir, "host-id");
    await writeFixtureFile(dataDir, "auth.json");
    await writeFixtureFile(dataDir, "plugins/docs/host-data/state.json");

    expect(await listServerOwnedEntries(dataDir)).toEqual({
      entries: [],
      skippedPaths: [],
    });
  });
});
