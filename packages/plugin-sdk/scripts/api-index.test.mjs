import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectEntryExports,
  readPublicEntries,
  renderApiIndexes,
} from "./api-index.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function declaredExports(declarationFile) {
  const source = await readFile(declarationFile, "utf8");
  const declared = { values: [], types: [] };
  for (const match of source.matchAll(/^export( type)? \{([^}]*)\};/gmu)) {
    const names = match[2]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => name.split(/\s+as\s+/u).at(-1));
    (match[1] === undefined ? declared.values : declared.types).push(...names);
  }
  return {
    values: declared.values.sort(),
    types: declared.types.sort(),
  };
}

describe("plugin SDK API index", () => {
  const fixtures = [];

  async function fixture(files) {
    const root = await mkdtemp(path.join(tmpdir(), "bb-api-index-"));
    fixtures.push(root);
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    return root;
  }

  afterEach(async () => {
    await Promise.all(
      fixtures
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("reads the same exports from each entry point's source as its published declarations have", async () => {
    const entries = readPublicEntries(packageRoot);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(collectEntryExports(entry.source), entry.subpath).toEqual(
        await declaredExports(entry.types),
      );
    }
  });

  it("follows re-exports, keeps type-only exports as types, and leaves out @internal declarations", async () => {
    const root = await fixture({
      "entry.ts": [
        'export * from "./contract.js";',
        'export type * from "./values.js";',
        'export { helper as renamedHelper } from "./values.js";',
        'export { external } from "some-package";',
        'export type { ExternalShape } from "some-package";',
        'import { Shape } from "./contract.js";',
        "export { Shape as LocalShape };",
      ].join("\n"),
      "contract.ts": [
        "export interface Shape { id: string }",
        "export const marker = 1;",
        "/** @internal */",
        "export const retired = 1;",
      ].join("\n"),
      "values.ts": [
        "export function helper() {}",
        "export class Thing {}",
      ].join("\n"),
    });

    expect(collectEntryExports(path.join(root, "entry.ts"))).toEqual({
      values: ["external", "marker", "renamedHelper"],
      types: ["ExternalShape", "LocalShape", "Shape", "Thing", "helper"],
    });
  });

  it("refuses a star re-export from another package, whose names it cannot read", async () => {
    const root = await fixture({
      "entry.ts": 'export * from "some-package";',
    });

    expect(() => collectEntryExports(path.join(root, "entry.ts"))).toThrow(
      'export * from "some-package"',
    );
  });

  it("refuses to render while a public entry point belongs to no index", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        exports: {
          "./unlisted": {
            source: "./src/unlisted.ts",
            types: "./unlisted.d.ts",
          },
          "./internal/hidden": {
            source: "./src/hidden.ts",
            types: "./hidden.d.ts",
          },
        },
      }),
    });

    expect(() => renderApiIndexes(root)).toThrow(
      /API_INDEX_FILES: \.\/unlisted$/u,
    );
  });

  it("renders every export of an entry point under its import path without the host-only names", () => {
    const frontend = renderApiIndexes(packageRoot).find(
      (file) => file.filename === "frontend-api-index.md",
    );
    const app = readPublicEntries(packageRoot).find(
      (entry) => entry.subpath === "./app",
    );
    const { values, types } = collectEntryExports(app.source);
    const rendered = [
      ...frontend.content.matchAll(/`([A-Za-z_$][\w$]*)`/gu),
    ].map((match) => match[1]);
    const hidden = /^(?:InternalDoNotUse|internal_DO_NOT_USE_)/u;
    expect(frontend.content).toContain("## `@get-bb/plugin-sdk/app`");
    expect(rendered.sort()).toEqual(
      [...values, ...types].filter((name) => !hidden.test(name)).sort(),
    );
    expect(frontend.content).not.toMatch(hidden);
  });
});
