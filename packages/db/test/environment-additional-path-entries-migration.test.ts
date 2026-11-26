import { expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  migrate,
  noopNotifier,
  upsertHost,
} from "../src/index.js";
import { rewindThreadFailureKindColumn } from "./helpers/rewind.js";

const ADDITIONAL_PATH_ENTRIES_MIGRATION_TIMESTAMP = 1795550504908;

it("turns each recorded additional path into an entry that replaces nothing, in order", () => {
  const db = createConnection(":memory:");
  try {
    migrate(db);
    const host = upsertHost(db, noopNotifier, { name: "test-host" });
    const { project } = createProject(db, noopNotifier, {
      name: "test-project",
      source: { type: "local_path", hostId: host.id, path: "/work/app" },
    });
    const create = (path: string) =>
      createEnvironment(db, noopNotifier, {
        projectId: project.id,
        hostId: host.id,
        path,
        providerOwnsPath: false,
        status: "ready",
        environmentProvider: null,
      });
    const withFolders = create("/work/with-folders");
    const withoutFolders = create("/work/without-folders");
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
      .run(ADDITIONAL_PATH_ENTRIES_MIGRATION_TIMESTAMP);
    rewindThreadFailureKindColumn(db);
    db.$client
      .prepare("UPDATE environments SET additional_paths = ? WHERE id = ?")
      .run(JSON.stringify(["/work/b", "/work/a"]), withFolders.id);

    migrate(db);

    const rows = db.$client
      .prepare<[], { id: string; additional_paths: string }>(
        "SELECT id, additional_paths FROM environments",
      )
      .all();
    const recorded = new Map(
      rows.map((row) => [row.id, JSON.parse(row.additional_paths)]),
    );
    expect(recorded.get(withFolders.id)).toEqual([
      { path: "/work/b", replaces: null },
      { path: "/work/a", replaces: null },
    ]);
    expect(recorded.get(withoutFolders.id)).toEqual([]);
  } finally {
    db.$client.close();
  }
});
