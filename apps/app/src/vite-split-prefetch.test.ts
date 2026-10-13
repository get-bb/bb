import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import { splitPrefetch } from "../vite-split-prefetch";

it("emits hashed URLs for only the requested module and its static dependencies", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bb-prefetch-")));
  try {
    await Promise.all(
      Object.entries({
        "index.html": '<script type="module" src="/main.js"></script>',
        "main.js":
          'import { value } from "./shared.js"; window.value = value; window.load = () => import("./heavy.js"); window.other = () => import("./other.js");',
        "shared.js": "export const value = Math.random();",
        "heavy.js":
          'import { value } from "./shared.js"; window.heavyExecuted = true; export default value;',
        "other.js": "window.otherExecuted = true;",
      }).map(([name, source]) => writeFile(join(root, name), source)),
    );
    await build({
      root,
      base: "/app/",
      configFile: false,
      logLevel: "silent",
      plugins: [splitPrefetch({ heavy: "heavy.js" })],
      build: { minify: false },
    });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const manifest = html.match(
      /id="bb-prefetch-heavy">([^<]+)<\/script>/,
    )?.[1];
    expect(manifest).toBeDefined();
    const urls: string[] = JSON.parse(manifest!);
    expect(urls.some((url) => /\/heavy-[\w-]+\.js$/.test(url))).toBe(true);
    expect(urls.some((url) => /\/index-[\w-]+\.js$/.test(url))).toBe(true);
    expect(urls.some((url) => url.includes("other-"))).toBe(false);
    for (const url of urls) {
      expect(url.startsWith("/app/assets/")).toBe(true);
      expect(
        await readFile(join(root, "dist", url.slice("/app/".length)), "utf8"),
      ).not.toBe("");
    }
    expect(html).not.toMatch(/<link[^>]+href="[^"]*heavy-/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
