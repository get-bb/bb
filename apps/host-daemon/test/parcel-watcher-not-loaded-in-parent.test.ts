import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";

// Regression test for get-bb/bb#1873.
//
// The host daemon must keep the native @parcel/watcher addon OUT of the parent
// process: parcel runs in a forked child (see start-host-daemon.ts). The
// in-process fallback in packages/host-watcher reaches the addon through a
// dynamic import. esbuild inlines a dynamic import of an INTERNAL module and
// hoists that module's static `import ... from "@parcel/watcher"` to the top of
// the daemon bundle, so watcher.node loads at daemon startup, before pty.node.
//
// On macOS, dyld coalesces weak template instantiations across images, so
// node-pty's call to Napi::details::CallbackData<...>::Wrapper binds to
// watcher.node's copy, which is compiled with NAPI_DISABLE_CPP_EXCEPTIONS and
// has no try/catch. A failed PtyFork then throws Napi::Error into a frame that
// cannot catch it -> std::terminate -> SIGABRT.
//
// This test bundles @bb/host-watcher with the daemon bundle's esbuild settings,
// then (1) asserts the output has no static import of @parcel/watcher and
// (2) imports the bundle in a child node process and asserts that no
// @parcel/watcher addon is dlopen'ed.

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, "..", "..", "..");
const hostWatcherEntry = resolve(
  workspaceRoot,
  "packages",
  "host-watcher",
  "src",
  "index.ts",
);

// The bundle must live inside the host-daemon package (like dist/daemon-bundle.mjs)
// so the external @parcel/watcher resolves when the child process imports it.
const packageTmpDir = resolve(here, "..", ".tmp");
await mkdir(packageTmpDir, { recursive: true });
const outDir = await mkdtemp(join(packageTmpDir, "bb-1873-bundle-"));
const outfile = join(outDir, "host-watcher-bundle.mjs");

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

async function bundleHostWatcherLikeTheDaemon(): Promise<string> {
  // Mirror apps/host-daemon/scripts/build-bundles.mjs (native addons external,
  // same format/conditions/target), minus minify so the output stays greppable.
  await build({
    bundle: true,
    conditions: ["source"],
    entryPoints: [hostWatcherEntry],
    external: [
      "@parcel/watcher",
      "@parcel/watcher/*",
      "node-pty",
      "node-pty/*",
    ],
    format: "esm",
    legalComments: "none",
    minify: false,
    outfile,
    platform: "node",
    sourcemap: false,
    target: "node22",
  });
  return readFile(outfile, "utf8");
}

describe("daemon bundle keeps @parcel/watcher out of the parent process", () => {
  it("does not hoist a static import of @parcel/watcher", async () => {
    const bundle = await bundleHostWatcherLikeTheDaemon();
    const staticImports = bundle.match(
      /^import\s+[^;]*?\s+from\s*["']@parcel\/watcher["'];?$/gmu,
    );
    expect(
      staticImports,
      `static top-level import(s) of @parcel/watcher found in the bundle; ` +
        `watcher.node would load at daemon startup:\n${(staticImports ?? []).join("\n")}`,
    ).toBeNull();
    // The lazy path must stay a real dynamic `import("@parcel/watcher")`.
    expect(bundle).toMatch(/import\(\s*["']@parcel\/watcher["']\s*\)/u);
  });

  it("does not dlopen a @parcel/watcher addon when the bundle is imported", async () => {
    await bundleHostWatcherLikeTheDaemon();
    // Preload that logs every native addon the process loads.
    const preload = join(outDir, "log-dlopen.cjs");
    await writeFile(
      preload,
      [
        "const orig = process.dlopen;",
        "process.dlopen = function (module, filename, flags) {",
        "  console.log(`[dlopen] ${filename}`);",
        "  return flags === undefined",
        "    ? orig.call(this, module, filename)",
        "    : orig.call(this, module, filename, flags);",
        "};",
        "",
      ].join("\n"),
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--require",
        preload,
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(outfile)}); console.log("[imported]");`,
      ],
      { cwd: workspaceRoot, env: { ...process.env, NODE_PATH: "" } },
    );
    expect(stdout).toContain("[imported]");
    const loadedAddons = stdout
      .split("\n")
      .filter((line) => line.startsWith("[dlopen] "));
    // Match both the package path (@parcel/watcher-<platform>/watcher.node)
    // and the pnpm store path (.pnpm/@parcel+watcher-<platform>@<ver>/...).
    expect(
      loadedAddons.filter((line) => /@parcel[/+]watcher/u.test(line)),
      `@parcel/watcher addon loaded on import:\n${loadedAddons.join("\n")}`,
    ).toEqual([]);
  });
});
