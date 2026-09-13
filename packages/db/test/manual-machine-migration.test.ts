import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createConnection,
  migrate,
  noopNotifier,
  upsertHost,
} from "../src/index.js";

it("backfills only non-local hosts, preserves all other columns and is idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-manual-migration-"));
  writeFileSync(join(directory, "host-id"), "local-host\n");
  const db = createConnection(join(directory, "bb.db"));
  try {
    migrate(db);
    for (const id of ["local-host", "enrolled-a", "enrolled-b", "managed-host"])
      upsertHost(db, noopNotifier, { id, name: id });
    db.$client
      .prepare(
        "UPDATE hosts SET machine_provider_id = ?, resource = ? WHERE id = ?",
      )
      .run("digitalocean", JSON.stringify({ dropletId: 123 }), "managed-host");
    const before = db.$client.prepare("SELECT * FROM hosts ORDER BY id").all();
    const sql = readFileSync(
      new URL("../drizzle/0117_machine_providers.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes("UPDATE hosts"));
    if (sql === undefined) throw new Error("Missing manual machine backfill");
    db.$client.exec(sql);
    const after = db.$client.prepare("SELECT * FROM hosts ORDER BY id").all();
    expect(after).toEqual(
      before.map((row) => {
        const parsed = hostRow(row);
        return parsed.id === "local-host" || parsed.machine_provider_id !== null
          ? row
          : {
              ...parsed,
              machine_provider_id: "manual",
              resource: JSON.stringify({ version: 1, hostId: parsed.id }),
            };
      }),
    );
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
    db.$client.exec(sql);
    migrate(db);
    expect(db.$client.prepare("SELECT * FROM hosts ORDER BY id").all()).toEqual(
      after,
    );
  } finally {
    db.$client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function hostRow(value: unknown): Record<string, unknown> & { id: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  )
    throw new Error("Invalid host row");
  return { ...value, id: value.id };
}
