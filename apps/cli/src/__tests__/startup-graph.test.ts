import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_COMMAND_GROUPS } from "../command-groups.js";
import { readBbAppVersion } from "./bb-app-version.js";

/**
 * Guards the mechanism behind `bb` startup time: the entry's static import
 * graph is commander plus a few node builtins, and each command group's
 * module — with the zod schemas, SDK, templates and plugin tooling behind it
 * — is `import()`-ed only when that command runs. The built CLI is
 * code-split along those `import()` boundaries, so a single stray static
 * import anywhere on the entry's static path pulls the whole subtree into
 * the entry chunk and every invocation pays for it again. A resolve hook
 * records which modules Node actually loaded, once for the sources under
 * tsx (real module boundaries whatever the build does) and once for a split
 * bundle built the way `@bb/cli#build` builds dist/index.js (the split
 * layout itself: a single-file bundle runs every command correctly but
 * evaluates all of it on each start).
 */
const execFileAsync = promisify(execFile);
const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspaceRoot = resolve(cliRoot, "..", "..");

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

const cliPackageJsonSchema = z.object({
  scripts: z.object({ build: z.string() }),
});

/**
 * `source` runs src/index.ts under tsx; `dist` runs the split bundle this
 * suite builds into its own temp dir.
 */
type CliEntry = "source" | "dist";

interface CliRun {
  stdout: string;
  /** Every module URL Node resolved while the command ran. */
  urls: string[];
}

describe("bb startup module graph", () => {
  let tempDir: string;
  let registerHooksPath: string;
  let distEntry: string;

  beforeAll(async () => {
    // Under apps/cli, not os.tmpdir(): version.ts walks up from the built
    // chunk directory to packages/bb-app/package.json, so the bundle has to
    // sit inside the workspace for `--version` to answer. `.tmp/` is
    // gitignored at every level.
    const packageTmpDir = join(cliRoot, ".tmp");
    await mkdir(packageTmpDir, { recursive: true });
    tempDir = await mkdtemp(join(packageTmpDir, "startup-graph-"));
    registerHooksPath = join(tempDir, "register-hooks.mjs");
    distEntry = join(tempDir, "dist", "index.js");
    await writeFile(join(tempDir, "resolve-hooks.mjs"), RESOLVE_HOOKS_SOURCE);
    await writeFile(registerHooksPath, REGISTER_HOOKS_SOURCE);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(
    entry: CliEntry,
    args: string[],
    serverUrl?: string,
  ): Promise<CliRun> {
    const logPath = join(
      tempDir,
      `${entry}_${args.join("_").replace(/\W/g, "_")}.log`,
    );
    await writeFile(logPath, "");
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !STRIPPED_ENV_KEYS.has(key),
      ),
    );
    env.BB_CLI_REEXEC = "1";
    env.BB_STARTUP_GRAPH_LOG = logPath;
    if (serverUrl !== undefined) env.BB_SERVER_URL = serverUrl;
    const entryArgs =
      entry === "source"
        ? [
            "--conditions=source",
            "--import",
            "tsx",
            "--import",
            registerHooksPath,
            "src/index.ts",
          ]
        : ["--import", registerHooksPath, distEntry];
    const { stdout } = await execFileAsync(
      process.execPath,
      [...entryArgs, ...args],
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

  it("answers --version from commander and node builtins alone", async () => {
    const run = await runCli("source", ["--version"]);

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
    const run = await runCli("source", ["thread", "--help"]);

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

  describe("split dist/index.js", () => {
    // esbuild names a lazily imported module's chunk `<module>-<hash>.js`
    // (a group's `index.ts` takes its directory name) and the shared pieces
    // it hoists `chunk-<hash>.js`.
    let chunkDirUrl: string;

    beforeAll(async () => {
      // Built here rather than read from apps/cli/dist: that directory is a
      // turbo output, and another test task's nested
      // `turbo run build --filter=@bb/cli` (the root `pnpm bb` wrapper that
      // @bb/scripts#test exercises) restores it in place, truncating each
      // file as it rewrites it, so a child started at that moment reads a
      // half-written module. Same invocation as the package's `build`
      // script minus `--clean-dist`, which would delete apps/cli/dist.
      chunkDirUrl = `${pathToFileURL(join(tempDir, "dist", "index-chunks")).href}/`;
      await execFileAsync(
        process.execPath,
        [
          resolve(workspaceRoot, "scripts", "build-node-entry.mjs"),
          "src/index.ts",
          distEntry,
          "--split",
        ],
        { cwd: cliRoot },
      );
    }, 60_000);

    it("is how @bb/cli#build builds the shipped CLI", async () => {
      // The cases below prove the split layout of the bundle built above;
      // this keeps dist/index.js (what bb-app packages) built the same way.
      const packageJson = cliPackageJsonSchema.parse(
        JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8")),
      );
      expect(packageJson.scripts.build.split(" ")).toContain("--split");
    });

    it("answers --version from the entry and its shared chunks alone", async () => {
      const run = await runCli("dist", ["--version"]);

      expect(run.stdout.trim()).toBe(await readBbAppVersion());
      expect(loaded(run, pathToFileURL(distEntry).href)).toHaveLength(1);

      // A build without `--split` resolves no chunk at all: every command
      // then evaluates the whole bundle again, which is what this layout
      // exists to avoid.
      const chunks = loaded(run, chunkDirUrl);
      expect(chunks).not.toHaveLength(0);
      // Only the shared chunks (version.ts and esbuild's module runtime): no
      // command group and no context-env chunk.
      for (const url of chunks) {
        expect(url).toMatch(/\/index-chunks\/chunk-[A-Z0-9]+\.js$/);
      }
    }, 30_000);

    it("loads only the thread chunk for `bb thread`", async () => {
      const run = await runCli("dist", ["thread", "--help"]);

      expect(run.stdout).toContain("Usage: bb thread");
      expect(loaded(run, `${chunkDirUrl}thread-`)).toHaveLength(1);

      // Every other group's chunk, the plugin proxy and mime-types stay on
      // disk unread. (`plugin-` also covers `plugin-cli-proxy-`.)
      const otherGroups = CORE_COMMAND_GROUPS.map((group) => group.name).filter(
        (name) => name !== "thread",
      );
      for (const name of [...otherGroups, "plugin-cli-proxy", "mime-types"]) {
        expect(loaded(run, `${chunkDirUrl}${name}-`), name).toEqual([]);
      }
    }, 30_000);

    it("executes plugin commands from the split artifact", async () => {
      const server = createServer(async (request, response) => {
        response.setHeader("content-type", "application/json");
        if (request.url === "/api/v1/plugins/contributions") {
          response.end(
            JSON.stringify({
              cliCommands: [
                { pluginId: "fixture-plugin", name: "fixture" },
              ],
            }),
          );
          return;
        }
        if (request.url !== "/api/v1/plugins/fixture-plugin/cli") {
          response.statusCode = 404;
          response.end();
          return;
        }
        let body = "";
        for await (const chunk of request) body += chunk;
        const { argv } = z
          .object({ argv: z.array(z.string()) })
          .parse(JSON.parse(body));
        response.end(
          JSON.stringify({
            exitCode: 0,
            stdout: `fixture ran: ${argv.join(" ")}`,
            stderr: "",
          }),
        );
      });
      await new Promise<void>((resolvePromise) =>
        server.listen(0, "127.0.0.1", resolvePromise),
      );
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Fixture server did not bind to a TCP port");
      }
      const serverUrl = `http://127.0.0.1:${address.port}`;

      try {
        for (const args of [
          ["fixture", "--help"],
          ["plugin", "run", "fixture-plugin", "--help"],
        ]) {
          const run = await runCli("dist", args, serverUrl);
          expect(run.stdout).toBe("fixture ran: --help\n");
        }
      } finally {
        await new Promise<void>((resolvePromise, rejectPromise) =>
          server.close((error) =>
            error ? rejectPromise(error) : resolvePromise(),
          ),
        );
      }
    }, 30_000);
  });
});
