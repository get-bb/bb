import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const files: string[] = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
).files;

const mapExclusions = files.filter(
  (entry) => entry.startsWith("!") && entry.endsWith(".map"),
);

it("excludes every sourcemap from the published package, at any depth", () => {
  expect(mapExclusions).toEqual(["!**/*.map"]);
});

it("keeps the sourcemap exclusion last so no later pattern re-includes maps", () => {
  expect(files.at(-1)).toBe("!**/*.map");
});
