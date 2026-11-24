import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OXLINT = join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
const run = promisify(execFile);
let dir;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "bb-core-sdk-binding-lint-"));
  await writeFile(
    join(dir, "oxlintrc.json"),
    JSON.stringify({
      plugins: [],
      jsPlugins: [join(ROOT, "scripts", "oxlint-plugin.mjs")],
      categories: { correctness: "off" },
      rules: { "bb/core-plugin-sdk-app-binding": "error" },
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lintLines(source) {
  const file = join(dir, "core.tsx");
  await writeFile(file, source);
  const result = await run(
    process.execPath,
    [OXLINT, "-c", join(dir, "oxlintrc.json"), "-f", "unix", file],
    { cwd: dir },
  ).catch((error) => {
    if (error.code !== 1) throw error;
    return error;
  });
  return {
    lines: [
      ...result.stdout.matchAll(/core\.tsx:(\d+):\d+: .*core-plugin-sdk-app/g),
    ].map((match) => Number(match[1])),
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("bb/core-plugin-sdk-app-binding", () => {
  it("flags value imports the core binding does not export", async () => {
    const { lines, output } = await lintLines(
      [
        'import { definePluginApp, experimental_useRpc } from "@get-bb/plugin-sdk/app";',
        'import * as sdkApp from "@get-bb/plugin-sdk/app";',
        'import sdkDefault from "@get-bb/plugin-sdk/app";',
        'export { experimental_useSdk } from "@get-bb/plugin-sdk/app";',
        'export * from "@get-bb/plugin-sdk/app";',
        'export const lazy = () => import("@get-bb/plugin-sdk/app");',
        "export const used = [definePluginApp, experimental_useRpc, sdkApp, sdkDefault];",
      ].join("\n"),
    );

    expect(lines, output).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("allows bound members and type-only imports", async () => {
    const { lines, output } = await lintLines(
      [
        'import { definePluginApp, useBbContext, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";',
        'import type { ExperimentalPageTitle } from "@get-bb/plugin-sdk/app";',
        'export { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";',
        'export type * from "@get-bb/plugin-sdk/app";',
        'import { experimental_useRpc } from "@get-bb/plugin-sdk";',
        "export type Props = PluginNavPanelProps | ExperimentalPageTitle;",
        "export const used = [definePluginApp, useBbContext, experimental_useRpc];",
      ].join("\n"),
    );

    expect(lines, output).toEqual([]);
  });
});
