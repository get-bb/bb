import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerPluginCommands,
  resolveNewPluginTarget,
} from "../commands/plugin.js";
import { installFakeNpm } from "./helpers/fake-npm.js";

describe("resolveNewPluginTarget", () => {
  it.each([
    ["hello", "bb-plugin-hello", "bb-plugin-hello"],
    ["bb-plugin-hello", "bb-plugin-hello", "bb-plugin-hello"],
    ["@acme/bb-plugin-hello", "@acme/bb-plugin-hello", "bb-plugin-hello"],
  ])("resolves %s", (name, expectedPackageName, expectedDirectoryName) => {
    expect(resolveNewPluginTarget(name)).toEqual({
      packageName: expectedPackageName,
      directoryName: expectedDirectoryName,
    });
  });

  it.each([
    "Hello",
    "bb-plugin-",
    "@acme/hello",
    "@acme/bb-plugin-Hello",
    "@acme/team/bb-plugin-hello",
  ])("rejects %s", (name) => {
    expect(resolveNewPluginTarget(name)).toBeNull();
  });
});

/**
 * `bb plugin new` runs npm itself, and the packaged CLI runs with
 * NODE_ENV=production (bb-app's launcher sets it), which npm reads as
 * `omit=dev`. Issue #1133: npm skipped the packages the scaffold needs, exited
 * 0, and the CLI reported success for a plugin that could not build.
 *
 * The fake npm (helpers/fake-npm.ts) reproduces npm's actual config rule rather
 * than recording arguments, so these pin the outcome — the scaffold's declared
 * tree is on disk, and the CLI only claims success when it is — instead of a
 * flag string the CLI happens to pass today. It also answers the
 * published-version probe, which now runs through npm rather than a raw fetch
 * so it honors the same `.npmrc` the install will read.
 */
describe.sequential("bb plugin new dependency install", () => {
  const originalCwd = process.cwd();
  let workDir: string;
  let logged: string[];
  let warned: string[];

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-new-"));
    process.chdir(workDir);
    // Only the fake npm is reachable, so a real npm can never service these —
    // neither the install nor the published-version probe.
    await installFakeNpm(workDir);
    vi.stubEnv("NODE_ENV", "production");
    logged = [];
    warned = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      warned.push(String(line));
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(workDir, { recursive: true, force: true });
  });

  async function runPluginNew(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerPluginCommands(program, () => "http://localhost");
    await program.parseAsync(["node", "bb", "plugin", "new", ...args]);
  }

  async function isInstalled(
    directoryName: string,
    packageName: string,
  ): Promise<boolean> {
    return stat(join(workDir, directoryName, "node_modules", packageName))
      .then(() => true)
      .catch(() => false);
  }

  it("installs the packages the plugin needs to build under NODE_ENV=production", async () => {
    await runPluginNew(["prod-env", "--app"]);

    // zod is imported by the generated server.ts and inlined by the build;
    // typescript/@types are what the scaffold typechecks against.
    expect(await isInstalled("bb-plugin-prod-env", "zod")).toBe(true);
    expect(await isInstalled("bb-plugin-prod-env", "typescript")).toBe(true);
    expect(await isInstalled("bb-plugin-prod-env", "clsx")).toBe(true);
    expect(warned).toEqual([]);
    expect(logged).toContain("Installed dependencies (npm install).");
    expect(logged).not.toContain("  npm install --include=dev");
  });

  it("installs headless scaffolds too, whose server.ts also imports zod", async () => {
    await runPluginNew(["headless"]);

    expect(await isInstalled("bb-plugin-headless", "zod")).toBe(true);
    expect(logged).toContain("Installed dependencies (npm install).");
  });

  it("accepts a tree npm hoisted to a workspace root", async () => {
    // npm installs the whole workspace and hoists when the scaffold lands
    // inside one, so the plugin's own node_modules stays empty even though
    // every package resolves. Warning here would send the author back to an
    // `npm install` that hoists again.
    await writeFile(
      join(workDir, "package.json"),
      JSON.stringify({ name: "host", private: true, workspaces: ["*"] }),
    );
    vi.stubEnv("BB_TEST_NPM_HOIST_TO", workDir);

    await runPluginNew(["hoisted", "--app"]);

    expect(await isInstalled("bb-plugin-hoisted", "zod")).toBe(false);
    expect(warned).toEqual([]);
    expect(logged).toContain("Installed dependencies (npm install).");
  });

  it("does not report success when npm exits 0 without installing the tree", async () => {
    vi.stubEnv("BB_TEST_NPM_ALWAYS_OMIT_DEV", "1");

    await runPluginNew(["silent-omit", "--app"]);

    expect(await isInstalled("bb-plugin-silent-omit", "typescript")).toBe(
      false,
    );
    expect(logged).not.toContain("Installed dependencies (npm install).");
    expect(warned.join("\n")).toMatch(
      /npm install reported success but .*\btypescript\b.* missing from node_modules/,
    );
    // The manual step is the only way out, so the next steps must show it.
    expect(logged).toContain("  npm install --include=dev");
  });

  it("pins the scaffold to this bb's SDK version", async () => {
    await runPluginNew(["pinned"]);

    const manifest: { devDependencies: Record<string, string> } = JSON.parse(
      await readFile(join(workDir, "bb-plugin-pinned", "package.json"), "utf8"),
    );
    expect(manifest.devDependencies["@get-bb/plugin-sdk"]).toBe(
      PLUGIN_SDK_VERSION,
    );
    expect(await isInstalled("bb-plugin-pinned", "@get-bb/plugin-sdk")).toBe(
      true,
    );
    expect(warned).toEqual([]);
  });

  it("warns, without failing, when this bb's SDK version is not on npm yet", async () => {
    // `npm view <pkg>@<version>` exits 0 printing nothing for a version that
    // does not exist — the release-train window this warning is for.
    vi.stubEnv("BB_TEST_NPM_VIEW", "missing");

    await runPluginNew(["unpublished"]);

    // Scaffolding still completes — only the install is at risk.
    expect(logged).toContain(
      "Created bb-plugin-unpublished/ (bb-plugin-unpublished).",
    );
    const warnings = warned.join("\n");
    expect(warnings).toContain(
      `@get-bb/plugin-sdk ${PLUGIN_SDK_VERSION} — this bb's SDK version — was not found on npm`,
    );
    expect(warnings).toContain("npm pack");
  });

  it("treats a 404 for the package itself as a positive miss", async () => {
    vi.stubEnv("BB_TEST_NPM_VIEW", "e404");

    await runPluginNew(["missing-package"]);

    expect(warned.join("\n")).toContain(
      `@get-bb/plugin-sdk ${PLUGIN_SDK_VERSION} — this bb's SDK version — was not found on npm`,
    );
  });

  it("warns rather than failing when the registry cannot be reached", async () => {
    vi.stubEnv("BB_TEST_NPM_VIEW", "error");

    await runPluginNew(["offline"]);

    expect(logged).toContain("Created bb-plugin-offline/ (bb-plugin-offline).");
    // A failed check must not claim the install will fail — only a positive
    // registry miss earns that firm warning.
    expect(warned.join("\n")).toContain("could not reach the npm registry");
    expect(warned.join("\n")).not.toContain("was not found on npm");
  });

  it("falls back to the manual step when npm is not on PATH", async () => {
    vi.stubEnv("PATH", join(workDir, "empty-bin"));

    await runPluginNew(["no-npm"]);

    expect(warned.join("\n")).toContain("Could not run npm install");
    expect(logged).toContain("  npm install --include=dev");
    // The probe shells out to the same missing npm, so it can only report that
    // it could not verify the pin — never that the version is unpublished.
    expect(warned.join("\n")).toContain("could not reach the npm registry");
    expect(warned.join("\n")).not.toContain("was not found on npm");
  });
});
