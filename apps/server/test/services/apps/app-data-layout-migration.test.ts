import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveApplicationDataPath,
  resolveApplicationPath,
  resolveLegacyApplicationDataPath,
} from "@bb/config/app-storage-paths";
import { migrateAppDataLayout } from "../../../src/services/apps/app-data-layout-migration.js";
import { testLogger } from "../../helpers/test-app.js";

describe("migrateAppDataLayout", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "bb-app-data-migration-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function seedLegacyApp(
    applicationId: "status" | "review-board",
    dataFiles: Record<string, string>,
  ): Promise<void> {
    const legacyDataPath = resolveLegacyApplicationDataPath(
      dataDir,
      applicationId,
    );
    await mkdir(resolveApplicationPath(dataDir, applicationId), {
      recursive: true,
    });
    for (const [relativePath, contents] of Object.entries(dataFiles)) {
      const filePath = path.join(legacyDataPath, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }
  }

  it("moves legacy data dirs to the app-data root", async () => {
    await seedLegacyApp("status", {
      "state.json": '{"ok":true}',
      "todos/todo_1": '{"id":"todo_1"}',
    });

    await migrateAppDataLayout({ dataDir, logger: testLogger });

    const dataPath = resolveApplicationDataPath(dataDir, "status");
    expect(
      await readFile(path.join(dataPath, "state.json"), "utf8"),
    ).toBe('{"ok":true}');
    expect(
      await readFile(path.join(dataPath, "todos", "todo_1"), "utf8"),
    ).toBe('{"id":"todo_1"}');
    await expect(
      stat(resolveLegacyApplicationDataPath(dataDir, "status")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is a no-op when nothing needs migrating", async () => {
    await expect(
      migrateAppDataLayout({ dataDir, logger: testLogger }),
    ).resolves.toBeUndefined();

    await seedLegacyApp("status", { "state.json": "{}" });
    await migrateAppDataLayout({ dataDir, logger: testLogger });
    // Second run: nothing left in the legacy layout, data stays put.
    await migrateAppDataLayout({ dataDir, logger: testLogger });
    expect(
      await readFile(
        path.join(resolveApplicationDataPath(dataDir, "status"), "state.json"),
        "utf8",
      ),
    ).toBe("{}");
  });

  it("leaves a legacy dir untouched when the app already has migrated data", async () => {
    const dataPath = resolveApplicationDataPath(dataDir, "status");
    await mkdir(dataPath, { recursive: true });
    await writeFile(path.join(dataPath, "state.json"), '"new"', "utf8");
    await seedLegacyApp("status", { "state.json": '"legacy"' });

    await migrateAppDataLayout({ dataDir, logger: testLogger });

    expect(await readFile(path.join(dataPath, "state.json"), "utf8")).toBe(
      '"new"',
    );
    expect(
      await readFile(
        path.join(
          resolveLegacyApplicationDataPath(dataDir, "status"),
          "state.json",
        ),
        "utf8",
      ),
    ).toBe('"legacy"');
  });

  it("ignores entries that are not valid application ids", async () => {
    const strayPath = path.join(dataDir, "apps", ".tmp-status-abc", "data");
    await mkdir(strayPath, { recursive: true });
    await writeFile(path.join(strayPath, "state.json"), "{}", "utf8");

    await migrateAppDataLayout({ dataDir, logger: testLogger });

    expect(await readFile(path.join(strayPath, "state.json"), "utf8")).toBe(
      "{}",
    );
  });
});
