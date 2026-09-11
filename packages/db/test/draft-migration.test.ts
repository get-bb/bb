import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  createDraft,
  createProject,
  createThread,
  getAppSettings,
  getProject,
  getThread,
  listStoredUiPreferences,
  migrate,
  noopNotifier,
  overwriteStoredUiPreference,
  upsertHost,
} from "../src/index.js";

describe("draft storage migration", () => {
  it("upgrades a persisted pre-draft database without changing existing state", () => {
    const db = createConnection(":memory:");
    let priorState: Buffer;
    let project: ReturnType<typeof createProject>["project"];
    let thread: ReturnType<typeof createThread>;
    let settings: ReturnType<typeof getAppSettings>;
    let preferences: ReturnType<typeof listStoredUiPreferences>;
    try {
      migrate(db);
      const host = upsertHost(db, noopNotifier, {
        name: "Existing host",
        type: "persistent",
      });
      project = createProject(db, noopNotifier, {
        name: "Existing project",
        source: {
          type: "local_path",
          hostId: host.id,
          path: "/tmp/existing-project",
        },
      }).project;
      thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        title: "Existing conversation",
        status: "idle",
      });
      settings = getAppSettings(db);
      overwriteStoredUiPreference(db, {
        key: "sidebar.organizationMode",
        valueJson: '"machine"',
      });
      preferences = listStoredUiPreferences(db);
      const migrations = readMigrationFiles({
        migrationsFolder: resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../drizzle",
        ),
      });
      const addedDrafts = migrations.find((entry) =>
        entry.sql.some((statement) =>
          statement.includes("CREATE TABLE `drafts`"),
        ),
      );
      if (!addedDrafts) throw new Error("Draft migration is missing");
      db.$client.exec("DROP TABLE draft_submission_receipts; DROP TABLE drafts");
      db.$client
        .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
        .run(addedDrafts.folderMillis);
      priorState = db.$client.serialize();
    } finally {
      db.$client.close();
    }

    const upgraded = createConnection(priorState);
    try {
      migrate(upgraded);
      expect(getProject(upgraded, project.id)).toEqual(project);
      expect(getThread(upgraded, thread.id)).toEqual(thread);
      expect(getAppSettings(upgraded)).toEqual(settings);
      expect(listStoredUiPreferences(upgraded)).toEqual(preferences);
      expect(
        createDraft(upgraded, {
          id: "draft_after_upgrade",
          projectId: project.id,
          payloadJson: '{"text":"Survives upgrade"}',
          searchText: "Survives upgrade",
          hasInput: true,
          creationFingerprint: "upgrade-fingerprint",
        }),
      ).toMatchObject({ revision: 1, projectId: project.id });
    } finally {
      upgraded.$client.close();
    }
  });
});
