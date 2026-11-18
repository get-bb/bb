import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const run = promisify(execFile);
let dir;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "bb-ime-lint-"));
  await writeFile(
    join(dir, "oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      jsPlugins: [join(ROOT, "scripts", "oxlint-plugin.mjs")],
      categories: { correctness: "off" },
      rules: { "bb/ime-safe-key-handlers": "error" },
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lintLines(source) {
  const file = join(dir, "handler.tsx");
  await writeFile(file, source);
  const result = await run(
    OXLINT,
    ["-c", join(dir, "oxlintrc.json"), "-f", "unix", file],
    { cwd: dir },
  ).catch((error) => error);
  return [...result.stdout.matchAll(/handler\.tsx:(\d+):\d+: .*ime-safe/g)].map(
    (match) => Number(match[1]),
  );
}

describe("bb/ime-safe-key-handlers", () => {
  it("flags raw Enter and Escape key checks in every comparison form", async () => {
    const lines = await lintLines(
      [
        "export function onKeyDown(event: KeyboardEvent, e: KeyboardEvent) {",
        '  if (event.key === "Enter") return 1;',
        '  if (e.key !== "Escape") return 2;',
        '  if ("Enter" == event.key) return 3;',
        "  switch (event.key) {",
        '    case "Escape":',
        "      return 4;",
        "  }",
        "}",
      ].join("\n"),
    );

    expect(lines).toEqual([2, 3, 4, 6]);
  });

  it("allows the IME-aware helper and keys that IMEs do not consume", async () => {
    const lines = await lintLines(
      [
        'import { isNonImeKey } from "@/lib/ime-keyboard";',
        "export function onKeyDown(event: KeyboardEvent) {",
        '  if (isNonImeKey(event, "Enter")) return 1;',
        '  if (event.key === "ArrowDown") return 2;',
        "  switch (event.key) {",
        '    case "Tab":',
        "      return 3;",
        "  }",
        "}",
      ].join("\n"),
    );

    expect(lines).toEqual([]);
  });
});
