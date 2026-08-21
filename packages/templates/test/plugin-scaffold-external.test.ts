import { readFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { scaffoldPlugin } from "../src/plugin-scaffold.js";

const execFileAsync = promisify(execFile);
const pluginSdkRoot = resolve(process.cwd(), "../plugin-sdk");
const dependencyRequire = createRequire(join(pluginSdkRoot, "package.json"));

const EXTERNAL_DEPENDENCIES = [
  "@hugeicons/core-free-icons",
  "@hugeicons/react",
  "@radix-ui/react-dialog",
  "@radix-ui/react-slot",
  "@testing-library/react",
  "@types/better-sqlite3",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "better-sqlite3",
  "class-variance-authority",
  "clsx",
  "cron-parser",
  "hono",
  "jsdom",
  "react",
  "react-dom",
  "tailwind-merge",
  "vaul",
  "vitest",
  "zod",
] as const;

const BACKEND_TEST = `
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

describe("scaffold backend", () => {
  it("loads, inspects, and atomically reloads through the packed harness", async () => {
    const host = createFakePluginHost({ pluginId: "external-backend" });
    await plugin(host.bb);
    await expect(host.harness.behavior.callRpc("greeting")).resolves.toEqual({
      greeting: "hello",
      loadCount: 1,
    });
    expect(host.harness.inspection.registrations.rpcMethods).toEqual(["greeting"]);

    const next = await host.harness.lifecycle.reload(plugin);
    await expect(next.harness.behavior.callRpc("greeting")).resolves.toEqual({
      greeting: "hello",
      loadCount: 2,
    });
    await next.harness.lifecycle.dispose();
  });
});
`;

const FRONTEND_TEST = `
// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

describe("scaffold frontend", () => {
  it("loads and renders a slot through the packed harness", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(
      app.homepageSections[0]!,
      { projectId: "proj_external" },
      {
        context: { projectId: "proj_external", threadId: null },
        rpc: { greeting: () => ({ greeting: "external", loadCount: 3 }) },
      },
    );

    fireEvent.click(slot.getByText("Say hello"));
    await slot.findByText("external (#3)");
    expect(slot.inspection.rpcCalls).toEqual([{ method: "greeting", input: null }]);
    slot.lifecycle.unmount();
  });
});
`;

const VITEST_CONFIG = `
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd()) } },
});
`;

const REPRESENTATIVE_SERVER = `
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  projectName: {
    input: z.object({ projectId: z.string() }),
    output: z.object({ name: z.string() }),
  },
});

async function verifyFullSdk(bb: BbPluginApi) {
  const thread = await bb.sdk.threads.spawn({
    projectId: "proj_fixture",
    environment: { type: "project-default" },
    prompt: "Verify the portable SDK contract",
  });
  const threadId: string = thread.id;

  const file = await bb.sdk.files.read({ path: "/tmp/fixture.txt" });
  const sha256: string = file.sha256;

  const project = await bb.sdk.projects.get({ projectId: "proj_fixture" });
  const projectName: string = project.name;
  const sourceId: string | undefined = project.sources[0]?.id;
  const attachment = await bb.sdk.projects.attachments.upload({
    projectId: "proj_fixture",
    clientFile: new Uint8Array([0, 1, 255]),
    filename: "fixture.bin",
    mimeType: "application/octet-stream",
  });
  const attachmentPath: string = attachment.path;

  const environment = await bb.sdk.environments.status({
    environmentId: "env_fixture",
  });
  const outcome: "available" | "not_applicable" | "unavailable" =
    environment.outcome;

  return { attachmentPath, outcome, projectName, sha256, sourceId, threadId };
}

export default function plugin(bb: BbPluginApi) {
  void verifyFullSdk;
  bb.rpc.register(rpcContract, {
    async projectName({ projectId }) {
      const project = await bb.sdk.projects.get({ projectId });
      return { name: project.name };
    },
  });
  bb.log.info("portable SDK fixture loaded");
}
`;

const REPRESENTATIVE_APP = `
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

function Panel() {
  const rpc = useRpc<typeof rpcContract>();
  void rpc.call("projectName", { projectId: "proj_fixture" }).then((result) => {
    const exactName: string = result.name;
    void exactName;
  });
  return null;
}

export default definePluginApp((app) => {
  app.slots.homepageSection({ id: "fixture", title: "Fixture", component: Panel });
});
`;

function packageRoot(name: string): string {
  try {
    return dirname(dependencyRequire.resolve(`${name}/package.json`));
  } catch {
    let current = dirname(dependencyRequire.resolve(name));
    while (true) {
      try {
        const manifest = JSON.parse(
          readFileSync(join(current, "package.json"), "utf8"),
        ) as { name?: string };
        if (manifest.name === name) return current;
      } catch {
        // Keep walking to the package root.
      }
      const parent = dirname(current);
      if (parent === current)
        throw new Error(`package root not found: ${name}`);
      current = parent;
    }
  }
}

async function linkExternalDependencies(targetDir: string): Promise<void> {
  for (const name of EXTERNAL_DEPENDENCIES) {
    const target = join(targetDir, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    // The scaffold declares some of these as real dependencies (zod), so the
    // install above may already have fetched a registry copy. Replace it, so
    // what is typechecked and executed is always this repo's version.
    await rm(target, { recursive: true, force: true });
    await symlink(packageRoot(name), target, "dir");
  }
}

/**
 * `npm pack` the workspace SDK — the exact artifact the scaffold's pin will
 * resolve to once it is published. Turbo builds the SDK before this suite, so
 * skip the package's prepack build instead of rebuilding it during test fanout.
 */
async function packPluginSdk(packDir: string): Promise<string> {
  await mkdir(packDir, { recursive: true });
  await execFileAsync(
    "npm",
    [
      "pack",
      "--silent",
      "--ignore-scripts",
      "--pack-destination",
      packDir,
    ],
    {
      cwd: pluginSdkRoot,
    },
  );
  const tarballs = (await readdir(packDir)).filter((name) =>
    name.endsWith(".tgz"),
  );
  expect(tarballs).toHaveLength(1);
  return join(packDir, tarballs[0]!);
}

/**
 * Install the packed tarball as the plugin's `@get-bb/plugin-sdk` — the
 * scaffold's own devDependency, resolved from a real npm install rather than a
 * tsconfig path map.
 *
 * Dev dependencies stay in: the pin lives there, and `--omit=dev` would prune
 * the very package being installed. The explicit tarball argument outranks the
 * manifest's version spec, so this works before the version is published.
 */
async function installPackedSdk(
  targetDir: string,
  tarball: string,
): Promise<void> {
  await execFileAsync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-package-lock",
      "--no-save",
      tarball,
    ],
    { cwd: targetDir },
  );
}

/** The `@get-bb/plugin-sdk` version a scaffold pins in devDependencies. */
async function scaffoldSdkPin(targetDir: string): Promise<string | undefined> {
  const manifest = JSON.parse(
    await readFile(join(targetDir, "package.json"), "utf8"),
  ) as { devDependencies?: Record<string, string> };
  return manifest.devDependencies?.["@get-bb/plugin-sdk"];
}

async function includeTestsInTypecheck(targetDir: string): Promise<void> {
  const tsconfigPath = join(targetDir, "tsconfig.json");
  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8")) as {
    include: string[];
  };
  tsconfig.include.push("*.test.ts", "*.test.tsx");
  await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
}

async function runTypecheck(targetDir: string): Promise<void> {
  const typescriptRoot = packageRoot("typescript");
  try {
    await execFileAsync(
      process.execPath,
      [join(typescriptRoot, "lib", "tsc.js"), "--project", "tsconfig.json"],
      { cwd: targetDir },
    );
  } catch (error) {
    const failed = error as { stderr?: string; stdout?: string };
    throw new Error(
      `external scaffold typecheck failed:\n${failed.stdout ?? ""}${failed.stderr ?? ""}`,
    );
  }
}

async function runVitest(targetDir: string): Promise<void> {
  const vitestRoot = packageRoot("vitest");
  try {
    await execFileAsync(
      process.execPath,
      [join(vitestRoot, "vitest.mjs"), "run", "--passWithNoTests=false"],
      { cwd: targetDir },
    );
  } catch (error) {
    const failed = error as { stderr?: string; stdout?: string };
    throw new Error(
      `external scaffold tests failed:\n${failed.stdout ?? ""}${failed.stderr ?? ""}`,
    );
  }
}

describe("external plugin scaffold types", () => {
  let workDir: string;
  let packRoot: string;
  let tarball: string;

  beforeAll(async () => {
    packRoot = await mkdtemp(join(tmpdir(), "bb-external-pack-"));
    tarball = await packPluginSdk(join(packRoot, "pack"));
  }, 180_000);

  afterAll(async () => {
    await rm(packRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-external-scaffold-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("typechecks full SDK results against the installed package, with library checks enabled", async () => {
    const targetDir = join(workDir, "bb-plugin-external");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-external",
      bbVersion: "0.9.0",
      app: true,
    });
    await writeFile(join(targetDir, "server.ts"), REPRESENTATIVE_SERVER);
    await writeFile(join(targetDir, "app.tsx"), REPRESENTATIVE_APP);
    // The scaffold's own pin, satisfied by the packed artifact.
    expect(await scaffoldSdkPin(targetDir)).toBe(PLUGIN_SDK_VERSION);
    await installPackedSdk(targetDir, tarball);
    await linkExternalDependencies(targetDir);

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    ) as {
      compilerOptions: {
        skipLibCheck: boolean;
        paths?: Record<string, string[]>;
      };
    };
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(false);
    // Nothing redirects @get-bb/plugin-sdk: what typechecks below is exactly
    // what an editor resolves from node_modules.
    expect(Object.keys(tsconfig.compilerOptions.paths ?? {})).toEqual(["@/*"]);
    await expect(
      access(join(targetDir, "types", "bb-plugin-sdk.d.ts")),
    ).rejects.toThrow();
    await expect(
      access(
        join(
          targetDir,
          "node_modules",
          "@get-bb",
          "plugin-sdk",
          "bundled-types",
          "bb-plugin-sdk.d.ts",
        ),
      ),
    ).resolves.toBeUndefined();

    await runTypecheck(targetDir);
  }, 300_000);

  it("installs the packed testing runtimes and executes scaffold backend and frontend tests", async () => {
    const packedListing = (
      await execFileAsync("tar", ["-tzf", tarball])
    ).stdout.split("\n");
    expect(packedListing).toContain("package/dist/testing/index.js");
    expect(packedListing).toContain("package/dist/testing/app.js");
    expect(packedListing).toContain(
      "package/bundled-types/bb-plugin-sdk-testing.d.ts",
    );
    expect(packedListing).toContain(
      "package/bundled-types/bb-plugin-sdk-testing-app.d.ts",
    );
    expect(
      packedListing.some((entry) => entry.startsWith("package/src/")),
    ).toBe(false);
    expect(
      packedListing.some((entry) => entry.startsWith("package/scripts/")),
    ).toBe(false);

    const backendDir = join(workDir, "bb-plugin-external-backend");
    await scaffoldPlugin({
      targetDir: backendDir,
      packageName: "bb-plugin-external-backend",
      bbVersion: "0.9.0",
    });
    await installPackedSdk(backendDir, tarball);
    await linkExternalDependencies(backendDir);
    await writeFile(join(backendDir, "server.test.ts"), BACKEND_TEST);
    await includeTestsInTypecheck(backendDir);

    expect(await readdir(join(backendDir, "node_modules", "@get-bb"))).toEqual([
      "plugin-sdk",
    ]);
    const installedSdk = join(
      backendDir,
      "node_modules",
      "@get-bb",
      "plugin-sdk",
    );
    const installedManifest = JSON.parse(
      await readFile(join(installedSdk, "package.json"), "utf8"),
    ) as {
      version: string;
      private?: boolean;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      exports: Record<string, { import: string; types: string }>;
    };
    // The packed package and the domain constant are two copies of one
    // version; a plugin that resolves them differently loads against an SDK it
    // did not declare.
    expect(installedManifest.version).toBe(PLUGIN_SDK_VERSION);
    expect(installedManifest.private).not.toBe(true);
    expect(JSON.stringify(installedManifest.dependencies ?? {})).not.toContain(
      "workspace:",
    );
    expect(
      JSON.stringify(installedManifest.optionalDependencies ?? {}),
    ).not.toContain("workspace:");
    expect(
      JSON.stringify(installedManifest.peerDependencies ?? {}),
    ).not.toContain("workspace:");
    for (const subpath of ["./testing", "./testing/app"] as const) {
      const entry = installedManifest.exports[subpath];
      await expect(
        access(join(installedSdk, entry.import.replace(/^\.\//u, ""))),
      ).resolves.toBeUndefined();
      const declarations = await readFile(
        join(installedSdk, entry.types.replace(/^\.\//u, "")),
        "utf8",
      );
      const bbImports = [
        ...declarations.matchAll(/from ['"](@(?:get-)?bb\/[^'"]+)['"]/gu),
      ].map((match) => match[1]);
      expect(new Set(bbImports)).toEqual(new Set(["@get-bb/plugin-sdk"]));
      expect(declarations).not.toContain("@bb/sdk");
      expect(declarations).not.toContain("@bb/server-contract");
    }
    for (const runtimePath of [
      "dist/testing/index.js",
      "dist/testing/app.js",
    ]) {
      const runtime = await readFile(join(installedSdk, runtimePath), "utf8");
      expect(runtime).not.toMatch(/from ['"]@bb\//u);
    }
    await expect(access(join(installedSdk, "src"))).rejects.toThrow();
    const backendTsconfig = JSON.parse(
      await readFile(join(backendDir, "tsconfig.json"), "utf8"),
    ) as {
      compilerOptions: {
        skipLibCheck: boolean;
        paths?: Record<string, string[]>;
      };
    };
    expect(backendTsconfig.compilerOptions.skipLibCheck).toBe(false);
    // No mapping to fall back on: the testing declarations import the package
    // root, which has to resolve through the install alone.
    expect(backendTsconfig.compilerOptions.paths).toBeUndefined();
    await runTypecheck(backendDir);
    await runVitest(backendDir);

    const frontendDir = join(workDir, "bb-plugin-external-frontend");
    await scaffoldPlugin({
      targetDir: frontendDir,
      packageName: "bb-plugin-external-frontend",
      bbVersion: "0.9.0",
      app: true,
    });
    const frontendSdk = join(
      frontendDir,
      "node_modules",
      "@get-bb",
      "plugin-sdk",
    );
    await mkdir(dirname(frontendSdk), { recursive: true });
    await symlink(installedSdk, frontendSdk, "dir");
    await linkExternalDependencies(frontendDir);
    await writeFile(join(frontendDir, "app.test.tsx"), FRONTEND_TEST);
    await writeFile(join(frontendDir, "vitest.config.ts"), VITEST_CONFIG);
    await includeTestsInTypecheck(frontendDir);
    await runTypecheck(frontendDir);
    await runVitest(frontendDir);
  }, 300_000);
});
