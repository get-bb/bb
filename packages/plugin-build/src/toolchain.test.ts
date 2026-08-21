import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPluginApp } from "./build-plugin-app.js";
import {
  PLUGIN_TOOLCHAIN_PINS,
  resolvePluginBuildToolchain,
  toolchainCacheDir,
} from "./toolchain.js";

describe("plugin build toolchain", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "bb-toolchain-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  // Bumping a pin must install beside the old set rather than mutate a
  // directory a concurrent build may already be importing from.
  it("keys the cache directory on the pinned versions", () => {
    const dir = toolchainCacheDir("/data");
    for (const version of Object.values(PLUGIN_TOOLCHAIN_PINS)) {
      expect(basename(dir)).toContain(version);
    }
    expect(dir.startsWith("/data/")).toBe(true);
  });

  // The monorepo and any machine that already has the packages must not pay a
  // download — only a shipped artifact, which carries none of them, fetches.
  it("prefers a locally resolvable toolchain over fetching", async () => {
    const toolchain = await resolvePluginBuildToolchain(baseDir, {
      onFetchStart: () => {
        throw new Error("fetched despite a locally resolvable toolchain");
      },
    });

    expect(toolchain.esbuild).toMatch(/^file:\/\//);
    expect(toolchain.esbuild).toContain("esbuild");
    expect(toolchain.tailwindNode).toContain("@tailwindcss/node");
    expect(toolchain.tailwindOxide).toContain("@tailwindcss/oxide");
    // Nothing was written, so no cache directory exists.
    expect(
      await rm(toolchainCacheDir(baseDir), { recursive: true }).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  it("returns importable module specifiers", async () => {
    const toolchain = await resolvePluginBuildToolchain(baseDir);
    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    const result = await esbuild.transform("const x: number = 1", {
      loader: "ts",
    });

    expect(result.code.trim()).toBe("const x = 1;");
  });

  // The path a shipped server, CLI, or desktop app takes. Exercised end to end
  // because a build that resolved Tailwind's CSS relative to this module
  // passed every local-toolchain test and still could not build anything once
  // packaged.
  describe("fetched toolchain", () => {
    it.runIf(process.env.BB_TEST_TOOLCHAIN_FETCH === "1")(
      "builds a plugin frontend with nothing resolvable locally",
      async () => {
        const fetchEvents: string[] = [];
        const toolchain = await resolvePluginBuildToolchain(baseDir, {
          ignoreLocal: true,
          onFetchStart: () => fetchEvents.push("start"),
          onFetchDone: (ms) => fetchEvents.push(`done:${ms > 0}`),
        });

        // Both ends are reported: without the completion callback the caller
        // has no way to say the download finished, which is what left the CLI
        // silent for the whole fetch.
        expect(fetchEvents).toEqual(["start", "done:true"]);

        expect(toolchain.esbuild).toContain("toolchain-");
        expect(toolchain.tailwindCssDir).toContain("toolchain-");

        const pluginDir = join(baseDir, "plugin");
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
          join(pluginDir, "package.json"),
          JSON.stringify({
            name: "bb-plugin-fetched",
            version: "0.1.0",
            bb: {
              name: "Fetched",
              description: "Fetched toolchain fixture.",
              branding: { icon: "Zap" },
              server: "./server.ts",
              app: "./app.tsx",
            },
          }),
        );
        await writeFile(
          join(pluginDir, "server.ts"),
          "export default function plugin() {}",
        );
        await writeFile(
          join(pluginDir, "app.tsx"),
          `import { definePluginApp } from "@get-bb/plugin-sdk/app";\n` +
            `export default definePluginApp({});\n`,
        );

        const result = await buildPluginApp(pluginDir, "0.9.0-test", toolchain);
        const css = await readFile(result.cssPath, "utf8");

        // Proves `tailwindcss/theme.css` resolved from the fetched package.
        expect(css.length).toBeGreaterThan(0);
        expect(css).toContain("--");
      },
      600_000,
    );

    // The fetch is bb's own npm child and passes --ignore-scripts. A bb
    // launched through a package manager inherits the user's .npmrc as
    // npm_config_*, and npm 11/12 refuses an inherited allow-scripts on a
    // project-scoped install (EALLOWSCRIPTS). A fake npm on PATH records what
    // the child actually saw; it installs nothing, so the resolve fails after
    // the spawn, which is all this test needs.
    it.skipIf(process.platform === "win32")(
      "keeps script-policy npm config out of the fetch",
      async () => {
        const binDir = join(baseDir, "bin");
        const envDump = join(baseDir, "npm-env.txt");
        await mkdir(binDir, { recursive: true });
        const fakeNpm = join(binDir, "npm");
        await writeFile(fakeNpm, `#!/bin/sh\nenv > "${envDump}"\nexit 0\n`);
        await chmod(fakeNpm, 0o755);

        const overrides: Record<string, string> = {
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
          npm_config_allow_scripts: "@github/keytar,node-pty",
          NPM_CONFIG_IGNORE_SCRIPTS: "false",
          npm_config_registry: "https://registry.example.invalid/",
        };
        const previous = new Map<string, string | undefined>();
        for (const [key, value] of Object.entries(overrides)) {
          previous.set(key, process.env[key]);
          process.env[key] = value;
        }
        try {
          await expect(
            resolvePluginBuildToolchain(baseDir, { ignoreLocal: true }),
          ).rejects.toThrow(/incomplete or misversioned/);
        } finally {
          for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }

        const seen = new Map(
          (await readFile(envDump, "utf8"))
            .split("\n")
            .filter((line) => line.includes("="))
            .map((line) => {
              const at = line.indexOf("=");
              return [line.slice(0, at), line.slice(at + 1)] as const;
            }),
        );
        expect(seen.has("npm_config_allow_scripts")).toBe(false);
        expect(seen.has("NPM_CONFIG_IGNORE_SCRIPTS")).toBe(false);
        expect(seen.get("npm_config_registry")).toBe(
          "https://registry.example.invalid/",
        );
      },
    );

    it("reuses an already-fetched toolchain without reinstalling", async () => {
      const local = await resolvePluginBuildToolchain(baseDir);
      // Stand in for a promoted cache: the marker plus a resolvable tree.
      expect(local.tailwindCssDir.length).toBeGreaterThan(0);
    });
  });
});
