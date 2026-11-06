import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, type Rolldown } from "vite";
import { expect, it } from "vitest";
import {
  PLUGIN_ZOD_RUNTIME_ID,
  pluginZodRuntime,
} from "../vite-plugin-zod-runtime";

it("gives plugins a separate zod copy so the boot chunk keeps its tree-shaken zod", async () => {
  const cacheDir = join(import.meta.dirname, "..", "node_modules", ".cache");
  await mkdir(cacheDir, { recursive: true });
  const root = await realpath(await mkdtemp(join(cacheDir, "bb-plugin-zod-")));
  try {
    await Promise.all(
      Object.entries({
        "index.html": '<script type="module" src="/main.js"></script>',
        "main.js": `import { ZodError } from "zod"; window.ZodError = ZodError; window.pluginZod = () => import("${PLUGIN_ZOD_RUNTIME_ID}");`,
      }).map(([name, source]) => writeFile(join(root, name), source)),
    );
    const output = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [pluginZodRuntime()],
      build: { minify: false, write: false },
    });
    const [result] = Array.isArray(output) ? output : [output];
    if (result === undefined || !("output" in result)) {
      throw new Error("expected a build result");
    }
    const chunks = result.output.filter(
      (item): item is Rolldown.OutputChunk => item.type === "chunk",
    );
    const entry = chunks.find((chunk) => chunk.isEntry);
    const plugin = chunks.find((chunk) => chunk.isDynamicEntry);
    if (entry === undefined || plugin === undefined) {
      throw new Error("expected an entry and a lazy zod chunk");
    }

    const entryModules = Object.keys(entry.modules);
    const pluginModules = Object.keys(plugin.modules).filter(
      (id) => !id.startsWith("\0rolldown/"),
    );
    expect(entryModules.some((id) => id.includes("/zod/"))).toBe(true);
    expect(pluginModules.length).toBeGreaterThan(0);
    expect(pluginModules.every((id) => id.startsWith("\0bb-plugin-zod:"))).toBe(
      true,
    );
    expect(entryModules.some((id) => id.startsWith("\0bb-plugin-zod:"))).toBe(
      false,
    );
    expect(entry.imports).not.toContain(plugin.fileName);
    expect(
      pluginModules.some((id) => /[\\/]locales[\\/]de\.js$/.test(id)),
    ).toBe(false);
    expect(plugin.code).toContain("ZodDiscriminatedUnion");
    expect(entry.code).not.toContain("ZodDiscriminatedUnion");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
