import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const files: string[] = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
).files;

const mapExclusions = files.filter(
  (entry) => entry.startsWith("!") && entry.endsWith(".map"),
);

// The published tarball once carried 100 MB of sourcemaps because the two
// exclusions here named exact paths (`dist/*.map`, `server/dist/index.js.map`)
// that were complete when written and silently stopped covering the tree as
// `start-server.js` and `server/dist/builtin-plugins` were added. Nothing
// enables source maps at runtime, so a map that ships is dead weight.
it("excludes every sourcemap from the published package, at any depth", () => {
  expect(mapExclusions).toEqual(["!**/*.map"]);
});

// npm applies `files` in order: an inclusive pattern after a negation
// re-includes what the negation dropped. A `server/dist` added below the
// negation would put every plugin map back in the tarball.
it("keeps the sourcemap exclusion last so no later pattern re-includes maps", () => {
  expect(files.at(-1)).toBe("!**/*.map");
});
