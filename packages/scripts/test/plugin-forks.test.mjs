import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  forkPluginPackageJson,
  forkPluginTsconfig,
  registryAliasImports,
  registryItemsForImports,
  registryPackages,
} from "../../../scripts/lib/plugin-fork.mjs";
import { rules } from "../../../scripts/oxlint-plugin.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const forkablePlugins = JSON.parse(
  readFileSync(join(ROOT, "scripts", "forkable-plugins.json"), "utf8"),
).plugins;
const registryDir = join(ROOT, "packages", "plugin-registry", "r");
const registryItems = readdirSync(registryDir)
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => JSON.parse(readFileSync(join(registryDir, name), "utf8")));

function lint(filename, visit) {
  const reports = [];
  const visitors = rules["forkable-plugin-imports"].create({
    filename,
    report: (report) => reports.push(report.message),
  });
  visit(visitors);
  return reports;
}

function literal(value) {
  return { type: "Literal", value };
}

describe("registry components at fork time", () => {
  it("finds the @/ imports a plugin file makes", () => {
    const source = [
      'import { Button } from "@/components/ui/button";',
      'import { cn } from "@/lib/utils";',
      'import { helper } from "./helper.js";',
      'const lazy = import("@/components/ui/dialog");',
      'vi.mock("@/components/ui/icon", () => ({}));',
    ].join("\n");

    expect([...registryAliasImports(source)].sort()).toEqual([
      "@/components/ui/button",
      "@/components/ui/dialog",
      "@/components/ui/icon",
      "@/lib/utils",
    ]);
  });

  it("vendors the imported items with every registry item they depend on", () => {
    const items = registryItemsForImports(
      new Set(["@/components/ui/button"]),
      registryItems,
    );

    expect(items.map((item) => item.name)).toEqual([
      "button",
      "motion",
      "utils",
    ]);
  });

  it("vendors the host-backed icon, not a glyph map", () => {
    const [icon] = registryItemsForImports(
      new Set(["@/components/ui/icon"]),
      registryItems,
    );

    expect(icon.files[0].content).toContain("experimental_Icon");
    expect(icon.dependencies).toBeUndefined();
  });

  it("refuses an @/ import no registry item provides", () => {
    expect(() =>
      registryItemsForImports(new Set(["@/app/model/fixtures"]), registryItems),
    ).toThrow(
      "@/app/model/fixtures is not a file of any component registry item",
    );
  });

  it("declares shimmed packages for types and bundled packages as dependencies", () => {
    const items = registryItemsForImports(
      new Set(["@/components/ui/checkbox"]),
      registryItems,
    );

    expect(
      registryPackages(items, {
        shimmedPackages: new Set(["clsx", "tailwind-merge"]),
        versions: {
          "@radix-ui/react-checkbox": "^1.3.7",
          clsx: "^2.1.1",
          "tailwind-merge": "^3.4.0",
        },
      }),
    ).toEqual({
      dependencies: { "@radix-ui/react-checkbox": "^1.3.7" },
      devDependencies: { clsx: "^2.1.1", "tailwind-merge": "^3.4.0" },
    });
  });

  it("points a fork's @/ alias at its own directory", () => {
    const tsconfig = {
      compilerOptions: {
        strict: true,
        paths: {
          "@/components/ui/icon": [
            "../../packages/plugin-registry/flavors/icon.tsx",
          ],
          "@/*": ["../../packages/shared-ui/src/*"],
        },
      },
      include: ["app.tsx"],
    };

    expect(forkPluginTsconfig(tsconfig)).toEqual({
      compilerOptions: { strict: true, paths: { "@/*": ["./*"] } },
      include: ["app.tsx"],
    });
  });
});

describe("forkPluginPackageJson", () => {
  const workspaceBinsByPackage = new Map([
    ["@bb/plugin-build", ["bb-plugin-build"]],
  ]);
  const noRegistryPackages = { dependencies: {}, devDependencies: {} };

  it("installs the SDK from the given source and drops workspace build tooling with its scripts", () => {
    const manifest = {
      name: "bb-plugin-thread-list",
      scripts: {
        test: "vitest run",
        "prepare:bundled": "bb-plugin-build prepare-bundled",
      },
      dependencies: { jotai: "^2.19.0" },
      devDependencies: {
        "@bb/plugin-build": "workspace:*",
        "@get-bb/plugin-sdk": "workspace:*",
        vitest: "^4.1.1",
      },
    };

    const forked = forkPluginPackageJson(manifest, {
      sdkSpecifier: "file:/tmp/get-bb-plugin-sdk.tgz",
      workspaceBinsByPackage,
      registryDependencies: noRegistryPackages,
    });

    expect(forked.manifest).toEqual({
      name: "bb-plugin-thread-list",
      scripts: { test: "vitest run" },
      dependencies: { jotai: "^2.19.0" },
      devDependencies: {
        "@get-bb/plugin-sdk": "file:/tmp/get-bb-plugin-sdk.tgz",
        vitest: "^4.1.1",
      },
    });
    expect(forked.droppedDevDependencies).toEqual(["@bb/plugin-build"]);
    expect(forked.droppedScripts).toEqual(["prepare:bundled"]);
    expect(manifest.devDependencies["@bb/plugin-build"]).toBe("workspace:*");
  });

  it("replaces @bb/shared-ui with the vendored items' packages without overriding the plugin's own", () => {
    const forked = forkPluginPackageJson(
      {
        dependencies: {
          "@bb/shared-ui": "workspace:*",
          "@radix-ui/react-slot": "^1.3.0",
        },
        devDependencies: { react: "^19.0.0" },
      },
      {
        sdkSpecifier: "0.5.16",
        workspaceBinsByPackage,
        registryDependencies: {
          dependencies: {
            "@radix-ui/react-checkbox": "^1.3.7",
            "@radix-ui/react-slot": "^1.2.0",
          },
          devDependencies: { clsx: "^2.1.1" },
        },
      },
    );

    expect(forked.manifest).toEqual({
      dependencies: {
        "@radix-ui/react-checkbox": "^1.3.7",
        "@radix-ui/react-slot": "^1.3.0",
      },
      devDependencies: { clsx: "^2.1.1", react: "^19.0.0" },
    });
  });

  it("refuses a plugin that needs another workspace package at runtime", () => {
    expect(() =>
      forkPluginPackageJson(
        { dependencies: { "@bb/client-core": "workspace:*" } },
        {
          sdkSpecifier: "0.5.16",
          workspaceBinsByPackage,
          registryDependencies: noRegistryPackages,
        },
      ),
    ).toThrow("dependencies.@bb/client-core is a workspace package");
  });
});

describe("bb/forkable-plugin-imports", () => {
  const pluginFile = join(
    ROOT,
    "plugins",
    "thread-list",
    "app",
    "list",
    "x.ts",
  );

  it("rejects bb workspace packages in every module position", () => {
    const reports = lint(pluginFile, (visitors) => {
      visitors.ImportDeclaration({ source: literal("@bb/shared-ui/button") });
      visitors.ExportAllDeclaration({ source: literal("@bb/client-core") });
      visitors.ImportExpression({ source: literal("@bb/shared-ui/icon") });
      visitors.TSImportType({ source: literal("@bb/domain") });
      visitors.CallExpression({
        callee: {
          type: "MemberExpression",
          object: { type: "Identifier", name: "vi" },
          property: { type: "Identifier", name: "mock" },
        },
        arguments: [literal("@bb/client-core")],
      });
    });

    expect(reports).toHaveLength(5);
    expect(reports[0]).toContain(
      "@bb/shared-ui/button is a bb workspace package",
    );
  });

  it("rejects workspace packages published under other names", () => {
    const reports = lint(pluginFile, (visitors) => {
      visitors.ImportDeclaration({
        source: literal("bb-environment-provider-host/git"),
      });
      visitors.ImportDeclaration({ source: literal("bb-plugin-tasks") });
      visitors.ImportDeclaration({
        source: literal("@get-bb/plugin-sdk/host"),
      });
      visitors.ImportDeclaration({ source: literal("cross-spawn") });
    });

    expect(reports).toEqual([
      expect.stringContaining(
        "bb-environment-provider-host/git is a bb workspace package",
      ),
      expect.stringContaining("bb-plugin-tasks is a bb workspace package"),
    ]);
  });

  it("rejects internal SDK modules and allows its public entry points", () => {
    const reports = lint(pluginFile, (visitors) => {
      visitors.ImportDeclaration({
        source: literal("@get-bb/plugin-sdk/internal/plugin-app-collector"),
      });
      visitors.ImportDeclaration({
        source: literal("@get-bb/plugin-sdk/testing/app"),
      });
    });

    expect(reports).toEqual([
      expect.stringContaining(
        "@get-bb/plugin-sdk/internal/plugin-app-collector is an internal SDK module",
      ),
    ]);
  });

  it("allows registry files through @/ and rejects other @/ paths", () => {
    const reports = lint(pluginFile, (visitors) => {
      visitors.ImportDeclaration({ source: literal("@/components/ui/button") });
      visitors.ImportDeclaration({
        source: literal("@/components/ui/hooks/use-compact-viewport"),
      });
      visitors.ImportDeclaration({ source: literal("@/lib/utils") });
      visitors.ImportDeclaration({ source: literal("@/app/model/fixtures") });
    });

    expect(reports).toEqual([
      expect.stringContaining(
        "@/app/model/fixtures is not a component registry file",
      ),
    ]);
  });

  it("rejects relative imports that leave the plugin and allows everything a copy has", () => {
    const reports = lint(pluginFile, (visitors) => {
      visitors.ImportDeclaration({
        source: literal("../../../../packages/domain/src/index.js"),
      });
      visitors.ImportDeclaration({ source: literal("../model/fixtures.js") });
      visitors.ImportDeclaration({ source: literal("@get-bb/plugin-sdk/app") });
      visitors.ImportDeclaration({ source: literal("@dnd-kit/core") });
      visitors.ExportNamedDeclaration({ source: null });
    });

    expect(reports).toEqual([
      expect.stringContaining("reaches outside the plugin directory"),
    ]);
  });

  it("leaves plugins that are not forkable alone", () => {
    const visitors = rules["forkable-plugin-imports"].create({
      filename: join(ROOT, "plugins", "tasks", "app.tsx"),
      report: () => {
        throw new Error("unexpected report");
      },
    });

    expect(visitors).toEqual({});
  });
});

describe("scripts/forkable-plugins.json", () => {
  it.each(forkablePlugins)(
    "%s runs the lint rule through its own lint script",
    (pluginDir) => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, pluginDir, "package.json"), "utf8"),
      );
      expect(manifest.scripts?.lint).toMatch(/^oxlint\b/);
    },
  );
});
