import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Guards the mechanism behind `bb` startup time: the entry's static import
 * graph is commander plus a few node builtins, and each command group's
 * module — with the zod schemas, SDK, templates and plugin tooling behind it
 * — is `import()`-ed only when that command runs. The built CLI is
 * code-split along those `import()` boundaries, so a single stray static
 * import anywhere on the entry's static path pulls the whole subtree into
 * the entry chunk and every invocation pays for it again. Running the
 * sources under tsx with a resolve hook records which modules Node actually
 * loaded.
 */
const execFileAsync = promisify(execFile);
const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = resolve(cliRoot, "..", "..");

/**
 * The hook appends every resolved module URL to the log file named by the
 * registration data. It is registered after tsx, so it heads the hook chain
 * and sees the final URL of each import whether static or dynamic.
 */
const RESOLVE_HOOKS_SOURCE = `
import { appendFileSync } from "node:fs";
let logPath;
export function initialize(data) {
  logPath = data.logPath;
}
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  appendFileSync(logPath, result.url + "\\n");
  return result;
}
`;

const REGISTER_HOOKS_SOURCE = `
import { register } from "node:module";
register(new URL("./resolve-hooks.mjs", import.meta.url), {
  data: { logPath: process.env.BB_STARTUP_GRAPH_LOG },
});
`;

/** Env the child must not inherit: a re-exec hop or a version override. */
const STRIPPED_ENV_KEYS = new Set(["BB_CLI", "BB_APP_VERSION"]);

interface CliRun {
  stdout: string;
  /** Every module URL Node resolved while the command ran. */
  urls: string[];
}

describe("bb startup module graph", () => {
  let tempDir: string;
  let registerHooksPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "bb-cli-startup-graph-"));
    registerHooksPath = join(tempDir, "register-hooks.mjs");
    await writeFile(join(tempDir, "resolve-hooks.mjs"), RESOLVE_HOOKS_SOURCE);
    await writeFile(registerHooksPath, REGISTER_HOOKS_SOURCE);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(args: string[]): Promise<CliRun> {
    const logPath = join(tempDir, `${args.join("_").replace(/\W/g, "_")}.log`);
    await writeFile(logPath, "");
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !STRIPPED_ENV_KEYS.has(key),
      ),
    );
    env.BB_CLI_REEXEC = "1";
    env.BB_STARTUP_GRAPH_LOG = logPath;
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        "--import",
        registerHooksPath,
        "src/index.ts",
        ...args,
      ],
      { cwd: cliRoot, env },
    );
    const urls = (await readFile(logPath, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0);
    return { stdout, urls };
  }

  function loaded(run: CliRun, fragment: string): string[] {
    return run.urls.filter((url) => url.includes(fragment));
  }

  async function readBbAppVersion(): Promise<string> {
    const packageJson: unknown = JSON.parse(
      await readFile(
        join(repoRoot, "packages", "bb-app", "package.json"),
        "utf8",
      ),
    );
    if (
      typeof packageJson === "object" &&
      packageJson !== null &&
      "version" in packageJson &&
      typeof packageJson.version === "string"
    ) {
      return packageJson.version;
    }
    throw new Error("packages/bb-app/package.json has no version");
  }

  it("answers --version from commander and node builtins alone", async () => {
    const run = await runCli(["--version"]);

    expect(run.stdout.trim()).toBe(await readBbAppVersion());

    // The hook must have observed the CLI's own graph, or the absence checks
    // below would pass vacuously.
    expect(loaded(run, "/apps/cli/src/index.ts")).toHaveLength(1);
    expect(loaded(run, "/commander/")).not.toHaveLength(0);

    for (const fragment of [
      "/zod/",
      "/undici/",
      "/mime-types/",
      "/node_modules/ws/",
      "/packages/config/",
      "/packages/domain/",
      "/packages/sdk/",
      "/packages/server-contract/",
      "/packages/templates/",
      "/apps/cli/src/commands/",
      "/apps/cli/src/plugin-cli-proxy",
      "/apps/cli/src/context-env",
      "/apps/cli/src/client",
    ]) {
      expect(loaded(run, fragment), fragment).toEqual([]);
    }
  }, 30_000);

  it("loads only the named command group for `bb thread`", async () => {
    const run = await runCli(["thread", "--help"]);

    expect(run.stdout).toContain("Usage: bb thread");
    expect(loaded(run, "/apps/cli/src/commands/thread/index.ts")).toHaveLength(
      1,
    );

    // Other groups stay unloaded: plugin.ts is the heaviest (plugin-build,
    // scaffold templates) and project.ts carries mime-db.
    for (const fragment of [
      "/apps/cli/src/commands/plugin.ts",
      "/apps/cli/src/commands/project.ts",
      "/packages/plugin-build/",
      "/packages/templates/src/plugin-scaffold",
      "/mime-types/",
    ]) {
      expect(loaded(run, fragment), fragment).toEqual([]);
    }
  }, 30_000);
});
