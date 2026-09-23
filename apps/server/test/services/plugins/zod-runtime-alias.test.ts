import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { afterEach, expect, it } from "vitest";
import { zodAliasFor } from "../../../src/services/plugins/plugin-runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bb-zod-alias-"));
  tempDirs.push(root);
  const dist = join(root, "dist");
  const zod = join(root, "node_modules", "zod");
  await mkdir(dist, { recursive: true });
  await mkdir(zod, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await writeFile(
    join(zod, "package.json"),
    JSON.stringify({
      name: "zod",
      type: "module",
      exports: { ".": "./index.js", "./mini": "./mini.js" },
    }),
  );
  await writeFile(join(zod, "index.js"), 'export const owner = "plugin";');
  await writeFile(join(zod, "mini.js"), 'export const owner = "plugin-mini";');
  const runtimePath = join(root, "zod-runtime.js");
  await writeFile(runtimePath, 'export const owner = "server";');
  return { root, dist, runtimePath };
}

it("loads the server's Zod for a prebuilt builtin without an installed Zod", async () => {
  const { root, dist, runtimePath } = await fixture();
  await rm(join(root, "node_modules"), { recursive: true });
  const serverEntry = join(dist, "server.js");
  await writeFile(serverEntry, 'export { owner } from "zod";');
  const alias = zodAliasFor({
    runtimePath,
    sourceKind: "builtin",
    serverEntry,
  });
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias });
  expect(await jiti.import(serverEntry)).toMatchObject({ owner: "server" });
});

it.each(["git", "npm", "path"] as const)(
  "preserves %s plugin Zod and subpath imports in dist/server.js",
  async (sourceKind) => {
    const { dist, runtimePath } = await fixture();
    const serverEntry = join(dist, "server.js");
    await writeFile(
      serverEntry,
      'export { owner } from "zod"; export { owner as miniOwner } from "zod/mini";',
    );
    const alias = zodAliasFor({ runtimePath, sourceKind, serverEntry });
    const jiti = createJiti(import.meta.url, { moduleCache: false, alias });
    expect(await jiti.import(serverEntry)).toMatchObject({
      owner: "plugin",
      miniOwner: "plugin-mini",
    });
  },
);

it("preserves a builtin's source dependencies during development", async () => {
  const { root, runtimePath } = await fixture();
  const serverEntry = join(root, "server.ts");
  await writeFile(serverEntry, 'export { owner } from "zod";');
  const alias = zodAliasFor({
    runtimePath,
    sourceKind: "builtin",
    serverEntry,
  });
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias });
  expect(await jiti.import(serverEntry)).toMatchObject({ owner: "plugin" });
});

it("keeps normal resolution when the server has no shared Zod runtime", async () => {
  const { dist } = await fixture();
  const serverEntry = join(dist, "server.js");
  await writeFile(serverEntry, 'export { owner } from "zod";');
  const alias = zodAliasFor({
    runtimePath: undefined,
    sourceKind: "builtin",
    serverEntry,
  });
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias });
  expect(await jiti.import(serverEntry)).toMatchObject({ owner: "plugin" });
});
