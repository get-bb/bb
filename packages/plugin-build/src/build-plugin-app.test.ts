import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { buildPluginApp, runtimeShimPlugin } from "./build-plugin-app.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

/**
 * The monorepo's own toolchain: `resolvePluginBuildToolchain` finds these as
 * devDependencies of this package and performs no download.
 */
function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "bb-toolchain-unused"));
}

function precedingScopeBounds(
  css: string,
  ruleIndex: number,
): {
  start: number;
  bodyStart: number;
  end: number;
} {
  const start = css.lastIndexOf("@scope", ruleIndex);
  const bodyStart = css.indexOf("{", start);
  let end = -1;
  let braceDepth = 0;
  for (let index = bodyStart; index < css.length; index += 1) {
    if (css[index] === "{") braceDepth += 1;
    if (css[index] === "}") braceDepth -= 1;
    if (braceDepth === 0) {
      end = index;
      break;
    }
  }
  return { start, bodyStart, end };
}

describe("plugin app runtime shim", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("re-derives @get-bb/plugin-sdk/app exports for every rebuild", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-shim-"));
    tempDirs.push(dir);
    const facadePath = join(dir, "app-facade.mjs");
    const facadeUrl = pathToFileURL(facadePath).href;

    async function bundle(importName: string): Promise<string> {
      const result = await build({
        stdin: {
          contents: `import { ${importName} } from "@get-bb/plugin-sdk/app"; export { ${importName} };`,
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

    const result = await buildPluginApp(
      dir,
      "0.9.0-test",
      await testToolchain(),
    );
    const css = await readFile(result.cssPath, "utf8");

    expect(css).toContain(
      '@scope ([data-bb-plugin="css-fixture"], [data-bb-plugin-root]:not([data-bb-plugin]))',
    );
    const utilityRuleIndex = css.indexOf(".flex-col");
    const utilityScope = precedingScopeBounds(css, utilityRuleIndex);
    expect(utilityRuleIndex).toBeGreaterThan(utilityScope.start);
    expect(utilityScope.end).toBeGreaterThan(utilityScope.bodyStart);
    expect(utilityRuleIndex).toBeLessThan(utilityScope.end);

    const authoredRuleIndex = css.indexOf(".bb71-authored-decoration");
    const authoredScope = precedingScopeBounds(css, authoredRuleIndex);
    expect(authoredRuleIndex).toBeGreaterThan(authoredScope.start);
    expect(authoredScope.end).toBeGreaterThan(authoredScope.bodyStart);
    expect(authoredRuleIndex).toBeGreaterThan(authoredScope.end);
  });

  it.each([
    ["non-SVG XML", "<html/>", /<svg> root element/],
    ["malformed XML", "<svg><path></svg>", /not valid SVG XML/],
    [
      "entity declarations",
      '<!DOCTYPE svg [<!ENTITY mark "x">]><svg>&mark;</svg>',
      /must not contain a doctype declaration/,
    ],
  ])(
    "rejects %s in a path-shaped branding.icon before building",
    async (_case, icon, expectedError) => {
      const dir = await mkdtemp(join(tmpdir(), "bb-plugin-icon-"));
      tempDirs.push(dir);
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: "bb-plugin-icon-fixture",
          version: "0.0.0",
          bb: {
            name: "Icon fixture",
            description: "Verifies compact icon validation.",
            branding: { icon: "./icon.svg" },
            server: "./server.ts",
            app: "./app.ts",
          },
        }),
      );
      await writeFile(
        join(dir, "server.ts"),
        "export default function plugin() {}\n",
      );
      await writeFile(join(dir, "app.ts"), "export default {};\n");
      await writeFile(join(dir, "icon.svg"), icon);

      await expect(
        buildPluginApp(dir, "0.9.0-test", await testToolchain()),
      ).rejects.toThrow(expectedError);
    },
  );
});
