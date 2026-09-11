import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanRuntimeOutputs } from "../../../scripts/clean-runtime-outputs.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("removes stale runtime artifacts while preserving plugin development outputs and source files", async () => {
  const root = mkdtempSync(join(tmpdir(), "bb-runtime-clean-"));
  roots.push(root);
  const removed = [
    "apps/server/dist/obsolete.js",
    "packages/bundled-plugins/dist/removed-plugin/package.json",
    "packages/plugin-build/dist/cli.js",
    "plugins/example/.bundled-runtime/obsolete.js",
  ];
  const preserved = [
    "plugins/example/dist/development.js",
    "plugins/example/server.ts",
    "apps/server/src/index.ts",
    "node_modules/installed-package/index.js",
    "data/bb.db",
  ];
  for (const path of [...removed, ...preserved]) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path);
  }
  await cleanRuntimeOutputs(root);
  await cleanRuntimeOutputs(root);
  for (const path of removed) expect(existsSync(join(root, path))).toBe(false);
  for (const path of preserved)
    expect(readFileSync(join(root, path), "utf8")).toBe(path);
});
