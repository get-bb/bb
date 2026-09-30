import { describe, expect, it } from "vitest";
import type { AppKeybindingOverrides } from "@bb/domain";
import {
  createConnection,
  getAppKeybindingOverrides,
  migrate,
  setAppKeybindingOverrides,
} from "../src/index.js";

const migrationTimestamp = 1790738477751;
const directions = ["left", "right", "up", "down"] as const;
const legacyOverrides: AppKeybindingOverrides = directions.map((direction) => ({
  command: `pane.focus.${direction}`,
  platform: "mac",
  shortcut: {
    key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`,
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: true,
  },
}));
const custom: AppKeybindingOverrides = [
  {
    command: "pane.focus.left",
    shortcut: {
      key: "h",
      mod: false,
      meta: false,
      control: true,
      alt: true,
      shift: false,
    },
  },
  { command: "pane.focus.right", shortcut: null },
  { command: "thread.new", shortcut: null },
];

function upgradeDatabase(overrides: AppKeybindingOverrides | undefined) {
  const db = createConnection(":memory:");
  migrate(db);
  db.$client.exec(
    "ALTER TABLE queued_thread_messages DROP COLUMN custom_options_json",
  );
  db.$client
    .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
    .run(migrationTimestamp);
  if (overrides !== undefined) setAppKeybindingOverrides(db, overrides);
  return db;
}

describe("pane focus compatibility migration", () => {
  it.each([
    { name: "untouched settings", overrides: undefined },
    { name: "empty overrides", overrides: [] },
    { name: "custom and disabled overrides", overrides: custom },
    {
      name: "all directions disabled",
      overrides: directions.map((direction) => ({
        command: `pane.focus.${direction}` as const,
        shortcut: null,
      })),
    },
  ])(
    "preserves effective defaults and explicit overrides on upgrade ($name)",
    ({ overrides }) => {
      const db = upgradeDatabase(overrides);
      try {
        migrate(db);
        const expected = [
          ...(overrides ?? []),
          ...legacyOverrides.filter(
            (binding) =>
              !overrides?.some(
                (override) => override.command === binding.command,
              ),
          ),
        ];
        expect(getAppKeybindingOverrides(db)).toEqual(expected);
        migrate(db);
        expect(getAppKeybindingOverrides(db)).toEqual(expected);
        setAppKeybindingOverrides(
          db,
          expected.filter((binding) => binding.command !== "pane.focus.up"),
        );
        const restarted = createConnection(db.$client.serialize());
        try {
          migrate(restarted);
          expect(getAppKeybindingOverrides(restarted)).toEqual(
            expected.filter((binding) => binding.command !== "pane.focus.up"),
          );
          setAppKeybindingOverrides(restarted, []);
          migrate(restarted);
          expect(getAppKeybindingOverrides(restarted)).toEqual([]);
        } finally {
          restarted.$client.close();
        }
      } finally {
        db.$client.close();
      }
    },
  );

  it("keeps fresh installations on live defaults across restart", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      expect(getAppKeybindingOverrides(db)).toEqual([]);
      const restarted = createConnection(db.$client.serialize());
      try {
        migrate(restarted);
        expect(getAppKeybindingOverrides(restarted)).toEqual([]);
      } finally {
        restarted.$client.close();
      }
    } finally {
      db.$client.close();
    }
  });

  it("rolls back settings and the ledger together, then retries safely", () => {
    const db = upgradeDatabase(custom);
    try {
      db.$client
        .exec(`CREATE TRIGGER reject_pane_migration BEFORE INSERT ON __drizzle_migrations
        WHEN NEW.created_at = ${migrationTimestamp}
        BEGIN SELECT RAISE(ABORT, 'migration interrupted'); END`);
      expect(() => migrate(db)).toThrow("Failed to run the query");
      expect(getAppKeybindingOverrides(db)).toEqual(custom);
      expect(
        db.$client
          .prepare("SELECT 1 FROM __drizzle_migrations WHERE created_at = ?")
          .get(migrationTimestamp),
      ).toBeUndefined();
      db.$client.exec("DROP TRIGGER reject_pane_migration");
      migrate(db);
      expect(getAppKeybindingOverrides(db)).toEqual([
        ...custom,
        ...legacyOverrides.slice(2),
      ]);
    } finally {
      db.$client.close();
    }
  });
});
