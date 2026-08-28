import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");

it("limits concurrent Turbo test tasks to the CI runner CPU count", () => {
  const workflow = readFileSync(
    resolve(repoRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const testStep = /- name: Test\n\s+run: ([^\n]+)/u.exec(workflow)?.[1];

  expect(testStep).toContain("--concurrency=4");
});
