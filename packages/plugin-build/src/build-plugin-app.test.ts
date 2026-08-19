import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
      'import "./app.css";\n' +
        'export const utilityClass = "flex-col";\n' +
        'export const siblingClass = "[&~*]:hidden";\n',
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

    // Tailwind utilities carry both scope arms; authored CSS stays global so
    // it can still target editor decorations rendered outside the mount. The
    // selector text is lightningcss's minified form (no quotes around an
    // identifier attribute value, no space after the list comma).
    const scope =
      ":where([data-bb-plugin=css-fixture],[data-bb-plugin-root]:not([data-bb-plugin]))";
    expect(css).toContain(`${scope} .flex-col`);
    expect(css).toContain(`${scope}.flex-col`);
    // A sibling variant gets only the descendant arm: with a portal root as
    // the subject's origin, `.X ~ *` would otherwise reach host siblings.
    const sibling = String.raw`.\[\&\~\*\]\:hidden`;
    expect(css).toContain(`${scope} ${sibling}`);
    expect(css).not.toContain(`${scope}${sibling}`);
    expect(css).not.toContain("@scope");
    expect(css).not.toContain(`${scope} .bb71-authored-decoration`);
    expect(css).toContain(".bb71-authored-decoration");
  });

  it("minifies app.js and app.css unless the caller asks for readable output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-minify-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-minify-fixture",
        version: "0.0.0",
        bb: {
          name: "Minify fixture",
          description: "Verifies artifact minification.",
          branding: { icon: "Zap" },
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
      [
        "/*! fixture-legal-comment */",
        'import "./app.css";',
        "function computeFixtureLabel(fixtureInputValue: string) {",
        '  const fixtureLocalResult = [fixtureInputValue, "flex-col"].join(" ");',
        "  return fixtureLocalResult;",
        "}",
        'export default computeFixtureLabel("bb-minify");',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(dir, "app.css"),
      ".bb71-authored {\n  color: hotpink;\n  margin: 0px;\n}\n",
    );
    const toolchain = await testToolchain();

    const minified = await buildPluginApp(dir, "0.9.0-test", toolchain);
    const minifiedJs = await readFile(minified.jsPath, "utf8");
    const minifiedCss = await readFile(minified.cssPath, "utf8");
    // Local identifiers are mangled and license comments dropped; the
    // program is intact (the string the entry exports survives).
    expect(minifiedJs).not.toContain("fixtureLocalResult");
    expect(minifiedJs).not.toContain("fixture-legal-comment");
    expect(minifiedJs).toContain("bb-minify");
    // Tailwind's optimizer minifies both the utilities and the authored CSS.
    expect(minifiedCss).toContain(".flex-col{flex-direction:column}");
    expect(minifiedCss).toContain(".bb71-authored{color:#ff69b4;margin:0}");
    expect(minifiedCss).not.toContain("\n  ");

    const readable = await buildPluginApp(dir, "0.9.0-test", toolchain, {
      minify: false,
    });
    const readableJs = await readFile(readable.jsPath, "utf8");
    const readableCss = await readFile(readable.cssPath, "utf8");
    expect(readableJs).toContain("fixtureLocalResult");
    expect(readableCss).toMatch(/\.flex-col \{\n\s+flex-direction: column;/);
    expect(readableCss).toContain(".bb71-authored {");
    expect(readableJs.length).toBeGreaterThan(minifiedJs.length);
    expect(readableCss.length).toBeGreaterThan(minifiedCss.length);
  });

  it("scans only the bundled files of a dependency that opts into Tailwind content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-scan-"));
    tempDirs.push(dir);
    // The dependency lives outside node_modules behind a symlink, the way a
    // pnpm workspace links @bb/shared-ui into a builtin plugin: esbuild
    // reports the real path, so the scan must match on real paths too.
    const uiPackageDir = join(dir, "packages", "fixture-ui");
    await mkdir(join(uiPackageDir, "src", "excluded"), { recursive: true });
    await writeFile(
      join(uiPackageDir, "package.json"),
      JSON.stringify({
        name: "fixture-ui",
        version: "0.0.0",
        type: "module",
        bb: { pluginTailwindContent: ["src/**/*", "!src/excluded/**/*"] },
      }),
    );
    await writeFile(
      join(uiPackageDir, "src", "used.ts"),
      'export const usedClass = "tracking-widest";\n',
    );
    await writeFile(
      join(uiPackageDir, "src", "unused.ts"),
      'export const unusedClass = "tracking-tighter";\n',
    );
    await writeFile(
      join(uiPackageDir, "src", "excluded", "bundled-but-excluded.ts"),
      'export const excludedClass = "tracking-normal";\n',
    );
    const pluginDir = join(dir, "plugin");
    await mkdir(join(pluginDir, "node_modules"), { recursive: true });
    await symlink(uiPackageDir, join(pluginDir, "node_modules", "fixture-ui"));
    await writeFile(
      join(pluginDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-scan-fixture",
        version: "0.0.0",
        type: "module",
        bb: {
          name: "Scan fixture",
          description: "Verifies dependency content scanning.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          app: "./app.ts",
        },
        dependencies: { "fixture-ui": "0.0.0" },
      }),
    );
    await writeFile(
      join(pluginDir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(pluginDir, "app.ts"),
      [
        'import { usedClass } from "fixture-ui/src/used.ts";',
        'import { excludedClass } from "fixture-ui/src/excluded/bundled-but-excluded.ts";',
        'export default [usedClass, excludedClass, "leading-loose"];',
        "",
      ].join("\n"),
    );
    // The plugin's own directory is still scanned whole, imported or not.
    await writeFile(
      join(pluginDir, "notes.ts"),
      'export const ownUnimported = "leading-tight";\n',
    );

    const result = await buildPluginApp(
      pluginDir,
      "0.9.0-test",
      await testToolchain(),
    );
    const css = await readFile(result.cssPath, "utf8");

    expect(css).toContain(".tracking-widest{");
    expect(css).toContain(".leading-loose{");
    expect(css).toContain(".leading-tight{");
    // Matched by the glob but never bundled: not scanned.
    expect(css).not.toContain(".tracking-tighter{");
    // Bundled but negated by the dependency's own pattern: not scanned.
    expect(css).not.toContain(".tracking-normal{");
    // The `:root` block carries the default token the utility reads and not
    // the host's semantic bridge, which is `inline reference` for plugins.
    expect(css).toMatch(/:root,:host\{[^}]*--tracking-widest:/);
    expect(css).not.toContain("--color-background:");
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
