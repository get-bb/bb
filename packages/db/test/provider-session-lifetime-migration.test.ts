import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, threadScope } from "@bb/domain";
import {
  createConnection,
  createThread,
  getThread,
  insertEvents,
  listEvents,
  migrate,
  noopNotifier,
} from "../src/index.js";

it("migrates existing threads to persistent without changing UUID provenance or history", () => {
  const db = createConnection(":memory:");
  try {
    migrate(db);
    const thread = createThread(db, noopNotifier, {
      projectId: PERSONAL_PROJECT_ID,
      providerId: "codex",
    });
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        environmentId: null,
        providerThreadId: "existing-native-uuid",
        scope: threadScope(),
        sequence: 1,
        type: "thread/identity",
        data: "{}",
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
      },
    ]);
    const before = listEvents(db, { threadId: thread.id });
    const journal: unknown = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    );
    if (
      typeof journal !== "object" ||
      journal === null ||
      !("entries" in journal) ||
      !Array.isArray(journal.entries)
    )
      throw new Error("Invalid migration journal");
    const migration = journal.entries.find(
      (entry: unknown): entry is { tag: string; when: number } =>
        typeof entry === "object" &&
        entry !== null &&
        "tag" in entry &&
        entry.tag === "0146_watery_warhawk" &&
        "when" in entry &&
        typeof entry.when === "number",
    );
    if (migration === undefined) throw new Error("Missing lifetime migration");
    db.$client.exec(
      "ALTER TABLE threads DROP COLUMN provider_session_lifetime",
    );
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
      .run(migration.when);
    migrate(db);
    migrate(db);
    expect(getThread(db, thread.id)?.providerSessionLifetime).toBe(
      "persistent",
    );
    expect(listEvents(db, { threadId: thread.id })).toEqual(before);
    expect(before[0]?.providerThreadId).toBe("existing-native-uuid");
  } finally {
    db.$client.close();
  }
});
