import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import {
  buildPluginApp,
  sharedUiRuntimeModuleFor,
  runtimeShimPlugin,
  RUNTIME_SLOT_BY_SPECIFIER,
} from "./build-plugin-app.js";
import { RUNTIME_EXPORT_MANIFEST } from "./generated/runtime-export-manifest.generated.js";
import { buildPluginServer } from "./build-plugin-server.js";
import { dropHostProvidedTailwind } from "./scope-plugin-utilities.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

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

  it("still builds a plugin that imports a retired SDK hook and warns with the replacement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-retired-"));
    tempDirs.push(dir);
    const facadePath = join(dir, "app-facade.mjs");
    await writeFile(facadePath, "export const first = 1;\n");
    const entry = join(dir, "app.tsx");
    await writeFile(
      entry,
      `import {\n  first,\n  experimental_useSidebarThreadPullRequest as useRowPullRequest,\n} from "@get-bb/plugin-sdk/app";\nexport { first, useRowPullRequest };\n`,
    );

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin(pathToFileURL(facadePath).href)],
    });

    expect(result.errors).toEqual([]);
    expect(result.outputFiles[0]?.text).toContain(
      "experimental_useSidebarThreadPullRequest",
    );
    expect(result.warnings).toMatchObject([
      {
        pluginName: "bb-plugin-runtime-shims",
        location: expect.objectContaining({ line: 4 }),
        text: expect.stringMatching(
          /^experimental_useSidebarThreadPullRequest is retired from @get-bb\/plugin-sdk\/app\. Existing plugins remain supported\. Render <experimental_ThreadRowMetadata thread=\{thread\} \/> in the row to draw bb's pull request badge, or read pull requests from the GitHub PR Status plugin: experimental_useRpcKeyedQuery\(\{ pluginId: "bb--github-pr-status"/,
        ),
      },
    ]);
  });

  it("has an export-manifest entry for every non-SDK slot", () => {
    for (const specifier of Object.keys(RUNTIME_SLOT_BY_SPECIFIER)) {
      if (specifier.endsWith("/plugin-sdk/app")) continue;
      expect(RUNTIME_EXPORT_MANIFEST[specifier], specifier).toBeDefined();
    }
  });

  it("routes host-resident libraries to runtime slots and forwards real default exports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-libs-"));
    tempDirs.push(dir);
    const result = await build({
      stdin: {
        contents: [
          `import clsx from "clsx";`,
          `import { twMerge } from "tailwind-merge";`,
          `import { cva } from "class-variance-authority";`,
          `import { Icon } from "@bb/shared-ui/icon";`,
          `import { useQuestionFormHost } from "@bb/shared-ui/question-form-host";`,
          `export { clsx, twMerge, cva, Icon, useQuestionFormHost };`,
        ].join("\n"),
        loader: "js",
        resolveDir: dir,
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin()],
    });
    const js = result.outputFiles[0]?.text ?? "";
    for (const slot of [
      "clsx",
      "tailwindMerge",
      "classVarianceAuthority",
      "sharedUiIcon",
      "questionFormHost",
    ]) {
      expect(js).toMatch(new RegExp(`runtime\\d*\\.${slot}\\b`));
    }

    const clsxFn = () => "clsx";
    const twMergeFn = () => "merged";
    const cvaFn = () => "cva";
    const IconComponent = () => null;
    const useQuestionFormHost = () => null;
    (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
      clsx: { default: clsxFn, clsx: clsxFn },
      tailwindMerge: { twMerge: twMergeFn },
      classVarianceAuthority: { cva: cvaFn },
      sharedUiIcon: { Icon: IconComponent, ICON_NAMES: [] },
      questionFormHost: { useQuestionFormHost },
    };
    try {
      const bundlePath = join(dir, "bundle.mjs");
      await writeFile(bundlePath, js);
      const loaded = (await import(pathToFileURL(bundlePath).href)) as Record<
        string,
        unknown
      >;
      expect(loaded.clsx).toBe(clsxFn);
      expect(loaded.twMerge).toBe(twMergeFn);
      expect(loaded.cva).toBe(cvaFn);
      expect(loaded.Icon).toBe(IconComponent);
      expect(loaded.useQuestionFormHost).toBe(useQuestionFormHost);
    } finally {
      delete (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime;
    }
  });

  it("shims shared-ui's relative ./icon import but bundles a plugin's own icon module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-icon-rel-"));
    tempDirs.push(dir);
    const sharedUiDir = join(dir, "node_modules", "@bb", "shared-ui");
    const files: Record<string, string> = {
      [join(sharedUiDir, "package.json")]: JSON.stringify({
        name: "@bb/shared-ui",
        type: "module",
        exports: {
          "./empty-state": "./src/components/ui/empty-state.tsx",
          "./icon": "./src/components/ui/icon.tsx",
        },
      }),
      [join(sharedUiDir, "src", "components", "ui", "icon.tsx")]:
        `export function Icon() { return "shared-ui-hugeicons-map"; }\n`,
      [join(sharedUiDir, "src", "components", "ui", "empty-state.tsx")]:
        `import { Icon } from "./icon";\nexport function EmptyState() { return Icon; }\n`,
      [join(dir, "components", "ui", "icon.tsx")]:
        `export function Icon() { return "plugin-owned-icon-map"; }\n`,
      [join(dir, "components", "ui", "button.tsx")]:
        `import { Icon } from "./icon";\nexport function Button() { return Icon; }\n`,
      [join(dir, "app.tsx")]:
        `import { EmptyState } from "@bb/shared-ui/empty-state";\nimport { Button } from "./components/ui/button";\nexport { EmptyState, Button };\n`,
    };
    for (const [filePath, contents] of Object.entries(files)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }
    const result = await build({
      entryPoints: [join(dir, "app.tsx")],
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin()],
    });
    const js = result.outputFiles[0]?.text ?? "";
    expect(js).not.toContain("shared-ui-hugeicons-map");
    expect(js).toMatch(/runtime\d*\.sharedUiIcon\b/);
    expect(js).toContain("plugin-owned-icon-map");
  });

  it("shims shared-ui's relative ./question-form-host import to the host's context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-question-host-rel-"));
    tempDirs.push(dir);
    const sharedUiDir = join(dir, "node_modules", "@bb", "shared-ui");
    const files: Record<string, string> = {
      [join(sharedUiDir, "package.json")]: JSON.stringify({
        name: "@bb/shared-ui",
        type: "module",
        exports: {
          "./question-form": "./src/components/ui/question-form.tsx",
        },
      }),
      [join(sharedUiDir, "src", "components", "ui", "question-form-host.tsx")]:
        `export function useQuestionFormHost() { return "bundled-default-context"; }\n`,
      [join(sharedUiDir, "src", "components", "ui", "question-form.tsx")]:
        `import { useQuestionFormHost } from "./question-form-host";\nexport function QuestionForm() { return useQuestionFormHost(); }\n`,
      [join(dir, "app.tsx")]:
        `import { QuestionForm } from "@bb/shared-ui/question-form";\nexport { QuestionForm };\n`,
    };
    for (const [filePath, contents] of Object.entries(files)) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }
    const result = await build({
      entryPoints: [join(dir, "app.tsx")],
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      write: false,
      logLevel: "silent",
      plugins: [runtimeShimPlugin()],
    });
    const js = result.outputFiles[0]?.text ?? "";
    expect(js).not.toContain("bundled-default-context");
    expect(js).toMatch(/runtime\d*\.questionFormHost\b/);
  });

  it("recognizes only shared-ui's own host-backed modules as relative imports", () => {
    const sharedUiComponent =
      "/repo/packages/shared-ui/src/components/ui/empty-state.tsx";
    expect(sharedUiRuntimeModuleFor("./icon", sharedUiComponent)).toBe(
      "@bb/shared-ui/icon",
    );
    expect(sharedUiRuntimeModuleFor("./icon.js", sharedUiComponent)).toBe(
      "@bb/shared-ui/icon",
    );
    expect(
      sharedUiRuntimeModuleFor(
        "../components/ui/icon",
        "/repo/packages/shared-ui/src/hooks/use-thing.ts",
      ),
    ).toBe("@bb/shared-ui/icon");
    expect(
      sharedUiRuntimeModuleFor(
        "./question-form-host",
        "/repo/packages/shared-ui/src/components/ui/question-form.tsx",
      ),
    ).toBe("@bb/shared-ui/question-form-host");
    expect(
      sharedUiRuntimeModuleFor(
        "./voice-input-textarea",
        "/repo/packages/shared-ui/src/components/ui/question-form.tsx",
      ),
    ).toBe("@bb/shared-ui/voice-input-textarea");
    expect(sharedUiRuntimeModuleFor("./button", sharedUiComponent)).toBe(null);
    expect(
      sharedUiRuntimeModuleFor(
        "./icon",
        "/plugins/acme/components/ui/button.tsx",
      ),
    ).toBe(null);
    expect(
      sharedUiRuntimeModuleFor(
        "./question-form-host",
        "/plugins/acme/components/ui/question-form.tsx",
      ),
    ).toBe(null);
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
        'export const utilityClass = "flex-col hover:underline has-[:focus]:opacity-50 group-has-[input:checked]/host:opacity-50 hover:group-has-[input:checked]/host:opacity-50 group-has-[input:checked]/host:[&>svg]:hidden space-y-3 [[data-scope-host]_&]:opacity-50 [[data-scope-host]~&]:opacity-50";\n' +
        'export const siblingClass = "[&~*]:hidden";\n',
    );
    await writeFile(
      join(dir, "app.css"),
      ".bb71-authored-decoration { text-decoration: underline; }\n" +
        "@keyframes bb71-authored-pulse { to { opacity: 0.5; } }\n",
    );

    const result = await buildPluginApp(
      dir,
      "0.9.0-test",
      await testToolchain(),
    );
    const css = await readFile(result.cssPath, "utf8");

    const scope =
      ":where([data-bb-plugin=css-fixture],[data-bb-plugin-root]:not([data-bb-plugin]))";
    expect(css).toContain(`${scope} .flex-col`);
    expect(css).toContain(`${scope}.flex-col`);
    const sibling = String.raw`.\[\&\~\*\]\:hidden`;
    expect(css).toContain(`${scope} ${sibling}`);
    expect(css).not.toContain(`${scope}${sibling}`);
    expect(css).not.toContain("@scope");
    expect(css).not.toContain(String.raw`:is(${scope} .hover\:underline`);
    expect(css).toContain(`${scope}.space-y-3`);
    expect(css).not.toContain(String.raw`:is(${scope} .group-has`);
    expect(css).toContain(
      String.raw`${scope}.group-has-\[input\:checked\]\/host\:opacity-50:is(:where(.group\/host):has(:is(input:checked)) *)`,
    );
    expect(css).toContain(
      String.raw`.hover\:group-has-\[input\:checked\]\/host\:opacity-50:hover`,
    );
    expect(css).toContain(
      String.raw`${scope}.group-has-\[input\:checked\]\/host\:\[\&\>svg\]\:hidden:is(:where(.group\/host):has(:is(input:checked)) *)>svg`,
    );
    expect(css).toContain(`[data-scope-host] ${scope}`);
    expect(css).toContain(`[data-scope-host]~${scope}`);
    expect(css).toContain(String.raw`${scope} .hover\:underline:hover`);
    expect(css).toContain(
      String.raw`${scope}.has-\[\:focus\]\:opacity-50:has(:focus)`,
    );
    expect(css).not.toContain(`${scope} .bb71-authored-decoration`);
    expect(css).not.toContain(`${scope}.bb71-authored-decoration`);
    expect(css.indexOf(".bb71-authored-decoration{")).toBeGreaterThan(
      css.lastIndexOf("@layer utilities{"),
    );
    expect(css).toContain("@keyframes bb71-authored-pulse");
  });

  it("builds retired tab registrations alongside retired hooks and returns migration warnings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-legacy-tabs-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-legacy-tabs-fixture",
        version: "0.0.0",
        bb: {
          name: "Legacy tabs",
          description: "Published API compatibility",
          branding: { icon: "Info" },
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
      `import { definePluginApp, experimental_useSidebarThreadPullRequest } from "@get-bb/plugin-sdk/app";
      const component = () => experimental_useSidebarThreadPullRequest("thread").pullRequest;
      export default definePluginApp((app) => {
        app.slots.threadPanelAction({ id: "legacy", title: "Legacy", component });
        app.slots.experimental_threadHeaderAction({ id: "chip", title: "Chip", component });
        app.slots.navPanel({ id: "board", title: "Board", icon: "Info", path: "board", component, fixedTabs: [{ id: "fixed", title: "Fixed", icon: "Info", component }] });
      });`,
    );
    const result = await buildPluginApp(
      dir,
      "0.9.0-test",
      await testToolchain(),
      { minify: true },
    );
    const warnings = result.migrationWarnings;
    expect(await readFile(result.jsPath, "utf8")).toContain(
      "threadPanelAction",
    );
    expect(await readFile(result.jsPath, "utf8")).toContain(
      "experimental_threadHeaderAction",
    );
    expect(warnings).toHaveLength(4);
    expect(warnings.join("\n")).toContain(
      "experimental_useSidebarThreadPullRequest",
    );
    expect(warnings.join("\n")).toContain('placement: "header"');
    expect(warnings.join("\n")).toContain("experimental_useRpcKeyedQuery");
    expect(warnings.join("\n")).toContain('availability: "action"');
    expect(warnings.join("\n")).toContain('availability: "fixed"');
    expect(
      warnings.filter((warning) =>
        warning.includes("frontend-registration.md#tab-api-migration"),
      ).length,
    ).toBe(2);
  });

  it("builds app and server code that still calls retired environment reads and warns with the Git plugin replacement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-retired-git-reads-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-retired-git-reads-fixture",
        version: "0.0.0",
        bb: {
          name: "Retired git reads",
          description: "Published API compatibility",
          branding: { icon: "Info" },
          server: "./server.ts",
          app: "./app.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      `export default function plugin(bb: any) {
        void bb.sdk.environments.status({ environmentId: "env_1" });
      }\n`,
    );
    await writeFile(
      join(dir, "app.ts"),
      `import { definePluginApp, useSdk } from "@get-bb/plugin-sdk/app";
      export function useFiles() {
        const sdk: any = useSdk();
        return sdk.environments.diffFiles({ environmentId: "env_1", target: "uncommitted" });
      }
      export default definePluginApp(() => {});`,
    );
    const toolchain = await testToolchain();
    const app = await buildPluginApp(dir, "0.9.0-test", toolchain);
    const server = await buildPluginServer(dir, "0.9.0-test", toolchain);

    expect(app.migrationWarnings).toEqual([
      expect.stringContaining(
        'environments.diffFiles is retired from the bb SDK typings and keeps working only for existing plugins. Read through the Git plugin instead: bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "files"',
      ),
    ]);
    expect(server.migrationWarnings).toEqual([
      expect.stringContaining(
        "server.ts: environments.status is retired from the bb SDK typings",
      ),
    ]);
  });

  it("records in app.meta.json the runtime slots the bundle imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-runtime-slots-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-runtime-slots-fixture",
        version: "0.0.0",
        bb: {
          name: "Runtime slots fixture",
          description: "Records the host runtime slots a bundle imports.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          app: "./app.tsx",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      "export default function plugin() {}\n",
    );
    await writeFile(
      join(dir, "app.tsx"),
      [
        'import { parsePatchFiles } from "@pierre/diffs";',
        'import { FileDiff } from "@pierre/diffs/react";',
        'import clsx from "clsx";',
        "export default function App() {",
        '  return <FileDiff fileDiff={parsePatchFiles("")[0]} className={clsx("a")} />;',
        "}",
        "",
      ].join("\n"),
    );

    const { metaPath } = await buildPluginApp(
      dir,
      "0.9.0-test",
      await testToolchain(),
    );
    expect(JSON.parse(await readFile(metaPath, "utf8")).runtimeSlots).toEqual([
      "clsx",
      "jsxRuntime",
      "pierreDiffs",
      "pierreDiffsReact",
    ]);
  });

  it("emits Tailwind rules the host provides, which dropHostProvidedTailwind removes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-properties-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-properties-fixture",
        version: "0.0.0",
        bb: {
          name: "Properties fixture",
          description:
            "Verifies plugin CSS leaves property registration to the host.",
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
      'export const classes = "shadow-md ring-2 blur-sm translate-x-1 bg-linear-to-r from-red-500 animate-in fade-in-0 zoom-in-95 animate-spin";\n',
    );

    const result = await buildPluginApp(
      dir,
      "0.9.0-test",
      await testToolchain(),
    );
    const built = await readFile(result.cssPath, "utf8");
    expect(built).toContain("@property --tw-enter-opacity");
    expect(built).toContain(":root,:host{");

    const css = dropHostProvidedTailwind(built);
    expect(css).toContain("--tw-enter-opacity:0");
    expect(css).toContain("@keyframes enter");
    expect(css).toContain("@keyframes spin");
    expect(css).not.toContain("@property");
    expect(css).not.toContain("@supports (((-webkit-hyphens");
    expect(css).not.toContain(":root");
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
    expect(minifiedJs).not.toContain("fixtureLocalResult");
    expect(minifiedJs).not.toContain("fixture-legal-comment");
    expect(minifiedJs).toContain("bb-minify");
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

  it("scans bundled Tailwind content from a symlinked workspace dependency by filesystem identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-plugin-scan-"));
    tempDirs.push(dir);
    const uiPackageDir = join(dir, "packages", "fixture-ui");
    await mkdir(join(uiPackageDir, "src", "excluded"), { recursive: true });
    await mkdir(join(uiPackageDir, "actual-src"), { recursive: true });
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
      join(uiPackageDir, "actual-src", "used.ts"),
      'export const usedClass = "tracking-widest";\n',
    );
    await symlink(
      "../actual-src/used.ts",
      join(uiPackageDir, "src", "used.ts"),
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
    await writeFile(
      join(pluginDir, "notes.ts"),
      'export const ownUnimported = "leading-tight";\n',
    );

    const aliasContainer = await mkdtemp(
      join(tmpdir(), "bb-plugin-scan-alias-"),
    );
    tempDirs.push(aliasContainer);
    const aliasedRoot = join(aliasContainer, "fixture");
    await symlink(dir, aliasedRoot);

    const result = await buildPluginApp(
      join(aliasedRoot, "plugin"),
      "0.9.0-test",
      await testToolchain(),
    );
    const css = await readFile(result.cssPath, "utf8");

    expect(css).toContain(".tracking-widest{");
    expect(css).toContain(".leading-loose{");
    expect(css).toContain(".leading-tight{");
    expect(css).not.toContain(".tracking-tighter{");
    expect(css).not.toContain(".tracking-normal{");
    expect(css).toMatch(/:root,:host\{[^}]*--tracking-widest:/);
    expect(css).not.toContain("--color-background:");
  });

  it.each([
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
