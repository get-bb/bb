import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");

const FRESH_SCHEMA_EXCEPTIONS = new Set([
  "src/services/hosts/host-environment.test.ts",
  "test/legacy-automations-export.test.ts",
  "test/services/plugins/plugin-native-server-loading.test.ts",
]);

function listTestSources(): string[] {
  return ["src", "test"].flatMap((directory) =>
    readdirSync(join(PACKAGE_ROOT, directory), { recursive: true })
      .map((entry) => `${directory}/${String(entry).split(sep).join("/")}`)
      .filter((path) =>
        directory === "test" ? path.endsWith(".ts") : path.endsWith(".test.ts"),
      ),
  );
}

it("builds in-memory test databases from the migrated template", () => {
  const offenders = listTestSources().filter(
    (path) =>
      !FRESH_SCHEMA_EXCEPTIONS.has(path) &&
      /createConnection\(\s*":memory:"/.test(
        readFileSync(join(PACKAGE_ROOT, path), "utf8"),
      ),
  );

  expect(
    offenders,
    'Use createMigratedConnection() from "@bb/db/testing" instead of migrating a fresh in-memory database per test.',
  ).toEqual([]);
});
