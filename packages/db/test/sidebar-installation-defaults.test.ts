import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  createConnection,
  migrate,
  createProject,
  createThread,
  upsertHost,
  noopNotifier,
} from "../src/index.js";

it("leaves a fresh migrated database without an installation override", () => {
  const db = createConnection(":memory:");
  try {
    migrate(db);
    expect(
      db.$client.prepare("SELECT * FROM ui_preference_defaults").all(),
    ).toEqual([]);
    expect(db.$client.prepare("SELECT * FROM ui_preferences").all()).toEqual(
      [],
    );
    db.$client.exec(
      `INSERT INTO ui_preferences VALUES ('sidebar.chronologicalSort', '"alpha"', 1, 1)`,
    );
    migrate(db);
    expect(
      db.$client.prepare("SELECT * FROM ui_preference_defaults").all(),
    ).toEqual([]);
  } finally {
    db.$client.close();
  }
});

describe.each(["project", "thread", "preference"] as const)(
  "existing installation with %s",
  (kind) => {
    it.each([null, "chronological", "machine", "project"])(
      "keeps saved choice %s separate from the fallback",
      (choice) => {
        const db = createConnection(":memory:");
        try {
          migrate(db);
          if (kind === "preference") {
            db.$client.exec(
              `INSERT INTO ui_preferences VALUES ('sidebar.chronologicalSort', '"alpha"', 1, 1)`,
            );
          } else if (kind === "thread") {
            createThread(db, noopNotifier, {
              projectId: PERSONAL_PROJECT_ID,
              providerId: "test-provider",
            });
          } else {
            const host = upsertHost(db, noopNotifier, {
              id: "host-sidebar",
              name: "Sidebar test",
            });
            createProject(db, noopNotifier, {
              name: "Existing project",
              source: {
                type: "local_path",
                hostId: host.id,
                path: "/tmp/sidebar-installation-defaults",
              },
            });
          }
          if (choice !== null) {
            db.$client
              .prepare(
                "INSERT INTO ui_preferences VALUES ('sidebar.organizationMode', ?, 4, 123)",
              )
              .run(JSON.stringify(choice));
          }
          const before = db.$client
            .prepare("SELECT * FROM ui_preferences")
            .all();
          const projects = db.$client.prepare("SELECT * FROM projects").all();
          const threads = db.$client.prepare("SELECT * FROM threads").all();
          db.$client.exec("DROP TABLE ui_preference_defaults");
          db.$client.exec(
            "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)",
          );
          migrate(db);
          expect(
            db.$client.prepare("SELECT * FROM ui_preference_defaults").all(),
          ).toEqual([
            { key: "sidebar.organizationMode", value_json: '"project"' },
          ]);
          expect(
            db.$client.prepare("SELECT * FROM ui_preferences").all(),
          ).toEqual(before);
          expect(db.$client.prepare("SELECT * FROM projects").all()).toEqual(
            projects,
          );
          expect(db.$client.prepare("SELECT * FROM threads").all()).toEqual(
            threads,
          );
          migrate(db);
          expect(
            db.$client.prepare("SELECT * FROM ui_preferences").all(),
          ).toEqual(before);
        } finally {
          db.$client.close();
        }
      },
    );
  },
);
