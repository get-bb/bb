import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createEnvironment,
  createProject,
  createThread,
  getAppKeybindingOverrides,
  getPluginKvValue,
  migrate,
  noopNotifier,
  upsertHost,
} from "../src/index.js";
import { createMigratedConnection } from "../src/testing.js";
import { z } from "zod";

it("moves review marks, hidden Git settings, tabs and platform-specific shortcuts without overwriting plugin state", () => {
  const db = createMigratedConnection();
  try {
    const host = upsertHost(db, noopNotifier, { name: "Git migration" });
    const { project } = createProject(db, noopNotifier, {
      name: "Git migration",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/git-migration",
      },
    });
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/git-migration",
      providerOwnsPath: false,
      status: "ready",
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "test-provider",
      status: "idle",
    });
    const journal = z
      .object({
        entries: z.array(z.object({ tag: z.string(), when: z.number() })),
      })
      .parse(
        JSON.parse(
          readFileSync(
            new URL("../drizzle/meta/_journal.json", import.meta.url),
            "utf8",
          ),
        ),
      );
    const migration = journal.entries.find(
      (entry) => entry.tag === "0147_pretty_cerebro",
    );
    if (!migration) throw new Error("Missing Git migration");
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
      .run(migration.when);
    db.$client.exec(
      readFileSync(
        new URL("../drizzle/0146_diff_viewed_files.sql", import.meta.url),
        "utf8",
      ),
    );
    const path = 'src/é"quote.ts';
    db.$client
      .prepare("INSERT INTO diff_viewed_files VALUES (?, ?, ?, ?, ?)")
      .run(environment.id, "uncommitted", path, "old-revision", 1);
    db.$client
      .prepare("INSERT INTO diff_viewed_files VALUES (?, ?, ?, ?, ?)")
      .run(environment.id, "commit:abcd", "other.ts", "commit-revision", 2);
    const existingKey = `viewed/${JSON.stringify([environment.id, "uncommitted", path])}`;
    db.$client
      .prepare("INSERT INTO plugin_kv VALUES (?, ?, ?, ?)")
      .run("bb--git", existingKey, JSON.stringify("plugin-revision"), 3);
    const settings = db.$client.prepare(
      "INSERT OR REPLACE INTO app_settings_values VALUES (?, ?, ?)",
    );
    settings.run("showGitChanges", "false", 4);
    const shortcut = {
      key: "x",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    };
    settings.run(
      "keybindingOverrides",
      JSON.stringify([
        { command: "diff.toggle", shortcut, platform: "mac" },
        {
          command: "plugin:bb--git/toggle-diff",
          shortcut: null,
          platform: "linux",
        },
      ]),
      4,
    );
    db.$client.prepare("INSERT INTO thread_tabs VALUES (?, ?, ?, ?)").run(
      thread.id,
      JSON.stringify([
        { id: "info", kind: "thread-info" },
        { id: "old-diff", kind: "git-diff" },
        { id: "new", kind: "new-tab", mode: "launcher" },
      ]),
      5,
      4,
    );
    migrate(db);
    expect(getPluginKvValue(db, "bb--git", existingKey)).toBe(
      JSON.stringify("plugin-revision"),
    );
    expect(
      getPluginKvValue(
        db,
        "bb--git",
        `viewed/${JSON.stringify([environment.id, "commit:abcd", "other.ts"])}`,
      ),
    ).toBe(JSON.stringify("commit-revision"));
    expect(
      getPluginKvValue(db, "core", "migrated-plugin-enabled/bb--git"),
    ).toBe("false");
    expect(
      db.$client
        .prepare(
          "SELECT key FROM app_settings_values WHERE key = 'showGitChanges'",
        )
        .get(),
    ).toBeUndefined();
    expect(getAppKeybindingOverrides(db)).toEqual([
      { command: "plugin:bb--git/toggle-diff", shortcut, platform: "mac" },
      {
        command: "plugin:bb--git/toggle-diff",
        shortcut: null,
        platform: "linux",
      },
    ]);
    const tabs = z
      .object({ tabs_json: z.string(), revision: z.number() })
      .parse(
        db.$client
          .prepare(
            "SELECT tabs_json, revision FROM thread_tabs WHERE thread_id = ?",
          )
          .get(thread.id),
      );
    expect(JSON.parse(tabs.tabs_json)).toEqual([
      { id: "info", kind: "thread-info" },
      {
        id: "plugin-fixed:bb--git:diff",
        kind: "plugin-fixed",
        pluginId: "bb--git",
        tabId: "diff",
      },
      { id: "new", kind: "new-tab", mode: "launcher" },
    ]);
    expect(tabs.revision).toBe(6);
    expect(
      db.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'diff_viewed_files'",
        )
        .get(),
    ).toBeUndefined();
    migrate(db);
    expect(getPluginKvValue(db, "bb--git", existingKey)).toBe(
      JSON.stringify("plugin-revision"),
    );
  } finally {
    db.$client.close();
  }
});
