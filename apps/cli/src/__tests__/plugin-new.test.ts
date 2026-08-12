import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerPluginCommands,
  resolveNewPluginTarget,
} from "../commands/plugin.js";

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
 * The fake npm reproduces npm's actual config rule rather than recording
 * arguments, so these pin the outcome — the scaffold's declared tree is on
 * disk, and the CLI only claims success when it is — instead of a flag string
 * the CLI happens to pass today.
 */
const FAKE_NPM = `#!/usr/bin/env node
const { mkdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const args = process.argv.slice(2);
// npm treats NODE_ENV=production as omit=dev; a command-line --include=dev
// outranks it. BB_TEST_NPM_ALWAYS_OMIT_DEV forces the omission to stand in for
// an install that silently drops packages.
const omitDev =
  process.env.BB_TEST_NPM_ALWAYS_OMIT_DEV === "1" ||
  (process.env.NODE_ENV === "production" && !args.includes("--include=dev"));
const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const installed = {
  ...manifest.dependencies,
  ...(omitDev ? {} : manifest.devDependencies),
};
// npm installs the whole workspace and hoists to its root when the package is
// a workspace member; BB_TEST_NPM_HOIST_TO stands in for that root.
const installRoot = process.env.BB_TEST_NPM_HOIST_TO ?? process.cwd();
for (const name of Object.keys(installed)) {
  mkdirSync(join(installRoot, "node_modules", ...name.split("/")), {
    recursive: true,
  });
}
`;

describe.sequential("bb plugin new dependency install", () => {
  const originalCwd = process.cwd();
  let workDir: string;
  let logged: string[];
  let warned: string[];

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-new-"));
    const binDir = join(workDir, "bin");
    await mkdir(binDir);
    await writeFile(join(binDir, "npm"), FAKE_NPM, { mode: 0o755 });
    process.chdir(workDir);
    // Only the fake npm is reachable, so a real npm can never service these.
    vi.stubEnv("PATH", `${binDir}${delimiter}${process.env.PATH ?? ""}`);
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

  it("falls back to the manual step when npm is not on PATH", async () => {
    vi.stubEnv("PATH", join(workDir, "empty-bin"));

    await runPluginNew(["no-npm"]);

    expect(warned.join("\n")).toContain("Could not run npm install");
    expect(logged).toContain("  npm install --include=dev");
  });
});
