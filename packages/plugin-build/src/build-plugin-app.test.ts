import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { buildPluginApp, runtimeShimPlugin } from "./build-plugin-app.js";

describe("plugin app runtime shim", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("re-derives @bb/plugin-sdk/app exports for every rebuild", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-shim-"));
    tempDirs.push(dir);
    const facadePath = join(dir, "app-facade.mjs");
    const facadeUrl = pathToFileURL(facadePath).href;

    async function bundle(importName: string): Promise<string> {
      const result = await build({
        stdin: {
          contents: `import { ${importName} } from "@bb/plugin-sdk/app"; export { ${importName} };`,
          loader: "js",
          resolveDir: dir,
        },
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        logLevel: "silent",
        plugins: [runtimeShimPlugin(facadeUrl)],
      });
      return result.outputFiles[0]?.text ?? "";
    }

    await writeFile(facadePath, "export const first = 1;\n");
    await expect(bundle("first")).resolves.toContain("first");

    await writeFile(
      facadePath,
      "export const first = 1; export const addedLater = 2;\n",
    );
    await expect(bundle("addedLater")).resolves.toContain("addedLater");
  });

  it("scopes Tailwind utilities while preserving imported CSS unscoped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-css-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-css-fixture",
        version: "0.0.0",
        bb: {
          name: "CSS fixture",
          description: "Verifies plugin CSS emission.",
          branding: { icon: "Paintbrush" },
          server: "./server.ts",
          app: "./app.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "app.ts"),
      'import "./app.css";\nexport const utilityClass = "flex-col";\n',
    );
    await writeFile(
      join(dir, "app.css"),
      ".bb71-authored-decoration { text-decoration: underline; }\n",
    );

    const result = await buildPluginApp(dir, "0.9.0-test");
    const css = await readFile(result.cssPath, "utf8");

    expect(css).toContain(
      '@scope ([data-bb-plugin="css-fixture"], [data-bb-plugin-root]:not([data-bb-plugin]))',
    );
    expect(css).toMatch(/@scope[^{}]+\{[\s\S]*?\.flex-col\s*\{/);
    const authoredRuleIndex = css.indexOf(".bb71-authored-decoration");
    const precedingScopeIndex = css.lastIndexOf("@scope", authoredRuleIndex);
    const precedingScopeBodyStart = css.indexOf("{", precedingScopeIndex);
    let precedingScopeEnd = -1;
    let braceDepth = 0;
    for (
      let index = precedingScopeBodyStart;
      index < authoredRuleIndex;
      index += 1
    ) {
      if (css[index] === "{") braceDepth += 1;
      if (css[index] === "}") braceDepth -= 1;
      if (braceDepth === 0) {
        precedingScopeEnd = index;
        break;
      }
    }
    expect(authoredRuleIndex).toBeGreaterThan(precedingScopeIndex);
    expect(precedingScopeEnd).toBeGreaterThan(precedingScopeBodyStart);
    expect(authoredRuleIndex).toBeGreaterThan(precedingScopeEnd);
  });
});
