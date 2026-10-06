import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import { routeModulePreload } from "../vite-route-modulepreload";

it("preloads the route chunk and its static dependencies that boot does not already load", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bb-route-preload-")));
  try {
    await Promise.all(
      Object.entries({
        "index.html": '<script type="module" src="/main.js"></script>',
        "main.js":
          'import { value } from "./shared.js"; window.value = value; window.route = import("./route.js"); window.other = () => import("./other.js");',
        "shared.js": "export const value = Math.random();",
        "route.js":
          'import { value } from "./shared.js"; import { extra } from "./route-dep.js"; export default value + extra;',
        "route-dep.js":
          'export const extra = Math.random(); window.routeDep = () => import("./route-lazy.js");',
        "route-lazy.js": "window.routeLazy = true;",
        "other.js": "window.other = true;",
      }).map(([name, source]) => writeFile(join(root, name), source)),
    );
    await build({
      root,
      base: "/app/",
      configFile: false,
      logLevel: "silent",
      plugins: [routeModulePreload("route.js")],
      build: { minify: false },
    });
    const html = await readFile(join(root, "dist/index.html"), "utf8");
    const preloaded = [
      ...html.matchAll(/<link rel="modulepreload" crossorigin href="([^"]+)">/g),
    ].map((match) => match[1] ?? "");
    expect(preloaded.some((href) => /\/route-[\w-]+\.js$/.test(href))).toBe(
      true,
    );
    expect(preloaded.some((href) => href.includes("route-lazy"))).toBe(false);
    expect(preloaded.some((href) => href.includes("other"))).toBe(false);
    expect(new Set(preloaded).size).toBe(preloaded.length);
    for (const href of preloaded) {
      expect(href.startsWith("/app/assets/")).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
