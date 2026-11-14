import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import { downloadBeforeImport } from "../vite-download-before-import";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("imports a lazy chunk only after every script it needs has downloaded", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bb-download-")));
  try {
    await Promise.all(
      Object.entries({
        "main.js":
          'import { value } from "./shared.js"; export const boot = value; export const load = () => import("./heavy.js"); export const loadOther = () => import("./other.js");',
        "shared.js": "export const value = Math.random();",
        "lazy-dep.js": "export const extra = 1;",
        "other.js": 'export { extra } from "./lazy-dep.js";',
        "heavy.js":
          'import { extra } from "./lazy-dep.js"; globalThis.heavyExecuted = true; export default extra;',
      }).map(([name, source]) => writeFile(join(root, name), source)),
    );
    await build({
      root,
      base: "./",
      configFile: false,
      logLevel: "silent",
      plugins: [downloadBeforeImport()],
      build: {
        minify: false,
        rolldownOptions: {
          input: join(root, "main.js"),
          preserveEntrySignatures: "strict",
          output: { entryFileNames: "[name].js" },
        },
      },
    });

    let online = false;
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (href: string) => {
        requested.push(href);
        if (!online) throw new TypeError("Failed to fetch");
        return new Response(await readFile(fileURLToPath(href)));
      }),
    );
    const link = {
      relList: { supports: () => true },
      setAttribute: () => undefined,
      addEventListener: () => undefined,
    };
    vi.stubGlobal("document", {
      querySelector: () => null,
      getElementsByTagName: () => [],
      createElement: () => ({ ...link }),
      head: { appendChild: () => undefined },
    });
    const preloadErrors: unknown[] = [];
    const window = new EventTarget();
    window.addEventListener("vite:preloadError", (event) => {
      preloadErrors.push((event as Event & { payload: unknown }).payload);
    });
    vi.stubGlobal("window", window);

    const app: { load: () => Promise<{ default: number }> } = await import(
      pathToFileURL(join(root, "dist/main.js")).href
    );
    await expect(app.load()).rejects.toThrow(
      /^Unable to download module script: .*\/heavy-[\w-]+\.js$/,
    );
    expect(Reflect.get(globalThis, "heavyExecuted")).toBeUndefined();
    expect(preloadErrors).toHaveLength(1);

    online = true;
    requested.length = 0;
    await expect(app.load()).resolves.toMatchObject({ default: 1 });
    expect(Reflect.get(globalThis, "heavyExecuted")).toBe(true);
    expect(requested.some((href) => /\/heavy-[\w-]+\.js$/.test(href))).toBe(
      true,
    );
    expect(requested.some((href) => /\/lazy-dep-[\w-]+\.js$/.test(href))).toBe(
      true,
    );

    requested.length = 0;
    await app.load();
    expect(requested).toEqual([]);
  } finally {
    Reflect.deleteProperty(globalThis, "heavyExecuted");
    await rm(root, { recursive: true, force: true });
  }
});
