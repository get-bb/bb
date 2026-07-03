import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments, upsertInstalledPlugin } from "@bb/db";
import {
  defaultExperiments,
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
} from "@bb/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

// The harness config uses serverPort 3334, so this host is on the local-app
// origin allowlist (asset routes take no auth, but keep requests realistic).
const BASE = "http://127.0.0.1:3334";

const run = promisify(execFile);

async function hasBinary(command: string): Promise<boolean> {
  try {
    await run(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const hasNpm = await hasBinary("npm");

const SERVER_SOURCE = `export default function plugin(bb: any) { bb.log.info("loaded"); }`;
// Minimal real frontend entry: the automatic JSX transform exercises the
// react/jsx-runtime shim, and the utility class exercises the Tailwind pass.
const APP_SOURCE = `export default function App() {\n  return <div className="line-clamp-2">hi</div>;\n}\n`;

async function writeAppPluginFixture(
  rootDir: string,
  options: { name: string; app?: boolean; appSource?: string },
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        server: "./server.ts",
        ...(options.app === false ? {} : { app: "./app.tsx" }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), SERVER_SOURCE);
  if (options.app !== false) {
    await writeFile(join(rootDir, "app.tsx"), options.appSource ?? APP_SOURCE);
  }
}

describe("plugin app bundles (build policy, inventory, asset routes)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("builds path installs at install time and serves hash-cached assets", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-appy");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-appy" });

    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.app.hasApp).toBe(true);
    const bundle = entry.app.bundle;
    expect(bundle).not.toBeNull();
    if (bundle === null) throw new Error("unreachable");
    expect(bundle.compatible).toBe(true);
    expect(bundle.sdkMajor).toBe(PLUGIN_SDK_MAJOR);
    expect(bundle.sdkVersion).toBe(PLUGIN_SDK_VERSION);
    expect(bundle.jsUrl).toBe(
      `/api/v1/plugins/appy/assets/app.js?h=${bundle.hash}`,
    );
    expect(bundle.cssUrl).toBe(
      `/api/v1/plugins/appy/assets/app.css?h=${bundle.hash}`,
    );
    // The install-time build materialized the dist outputs.
    await stat(join(rootDir, "dist", "app.js"));
    await stat(join(rootDir, "dist", "app.meta.json"));

    // Matching content hash → served immutable, correct content type.
    const js = await harness.app.request(`${BASE}${bundle.jsUrl}`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await js.text()).toContain("__bbPluginRuntime");

    const css = await harness.app.request(`${BASE}${bundle.cssUrl}`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    const cssText = await css.text();
    expect(cssText).toContain("line-clamp-2");
    // Regression (plugin CSS leak): the utilities layer must open straight
    // into @scope ([data-bb-plugin-root]) so plugin utility rules apply only
    // inside plugin mounts. Unscoped, a plugin's plain `.flex-col` (same
    // `utilities` layer, later stylesheet) overrides the host's
    // `sm:flex-row` on every host element — media queries add no
    // specificity, so the later plain rule wins page-wide.
    expect(cssText).toMatch(
      /@layer utilities \{\s*@scope \(\[data-bb-plugin-root\]\) \{/,
    );
    // And no utility rule sits in the utilities layer outside that scope.
    expect(cssText).not.toMatch(/@layer utilities \{\s*\./);

    // Wrong/absent hash still serves current bytes, but uncached.
    const staleHash = await harness.app.request(
      `${BASE}/api/v1/plugins/appy/assets/app.js?h=deadbeefdeadbeef`,
    );
    expect(staleHash.status).toBe(200);
    expect(staleHash.headers.get("cache-control")).toBe("no-store");
    const noHash = await harness.app.request(
      `${BASE}/api/v1/plugins/appy/assets/app.js`,
    );
    expect(noHash.status).toBe(200);
    expect(noHash.headers.get("cache-control")).toBe("no-store");

    // Unknown plugin / unknown asset file → 404.
    const unknownPlugin = await harness.app.request(
      `${BASE}/api/v1/plugins/nope/assets/app.js`,
    );
    expect(unknownPlugin.status).toBe(404);
    const unknownFile = await harness.app.request(
      `${BASE}/api/v1/plugins/appy/assets/evil.js`,
    );
    expect(unknownFile.status).toBe(404);
  }, 60_000);

  it("reports hasApp:false for headless plugins and 404s their assets", async () => {
    const rootDir = join(
      harness.config.dataDir,
      "fixtures",
      "bb-plugin-headless",
    );
    await writeAppPluginFixture(rootDir, {
      name: "bb-plugin-headless",
      app: false,
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.app).toEqual({ hasApp: false, bundle: null });

    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/headless/assets/app.js`,
    );
    expect(response.status).toBe(404);
  });

  it("fails the install when the frontend build fails", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-bad");
    await writeAppPluginFixture(rootDir, {
      name: "bb-plugin-bad",
      appSource: "export default function App( {\n", // syntax error
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(/frontend bundle build for "bad" failed/);
    // The failed install registered nothing.
    expect(harness.pluginService.list()).toHaveLength(0);
  }, 60_000);

  it("rebuilds a path plugin at load when the recorded SDK version is stale", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-aged");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-aged" });
    await harness.pluginService.installPath(rootDir);

    // Simulate a bundle built by an older BB: same major, older version.
    const metaPath = join(rootDir, "dist", "app.meta.json");
    await writeFile(
      metaPath,
      JSON.stringify({ sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: "0.0.0-stale" }),
    );
    await harness.pluginService.reload("aged");

    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    expect(meta.sdkVersion).toBe(PLUGIN_SDK_VERSION);
    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "aged");
    expect(entry?.app.bundle?.sdkVersion).toBe(PLUGIN_SDK_VERSION);
    expect(entry?.app.bundle?.compatible).toBe(true);
  }, 120_000);

  it("keeps an npm plugin's backend running with compatible:false on a major mismatch (no rebuild)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-oldie");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-oldie" });
    const staleMajor = PLUGIN_SDK_MAJOR + 1;
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(join(rootDir, "dist", "app.js"), "export default {};\n");
    await writeFile(
      join(rootDir, "dist", "app.meta.json"),
      JSON.stringify({ sdkMajor: staleMajor, sdkVersion: `${staleMajor}.0.0` }),
    );
    // Registered as an npm source (the managed-materialization step is not
    // under test); load must serve the published dist verbatim.
    upsertInstalledPlugin(harness.db, {
      id: "oldie",
      source: "npm:bb-plugin-oldie@0.1.0",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await harness.pluginService.reload("oldie");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "oldie");
    expect(entry?.status).toBe("running");
    expect(entry?.app.hasApp).toBe(true);
    expect(entry?.app.bundle).toMatchObject({
      sdkMajor: staleMajor,
      sdkVersion: `${staleMajor}.0.0`,
      compatible: false,
    });
    // npm bundles are never rebuilt — the published meta is untouched.
    const meta = JSON.parse(
      await readFile(join(rootDir, "dist", "app.meta.json"), "utf8"),
    );
    expect(meta.sdkVersion).toBe(`${staleMajor}.0.0`);
    // The backend (and even the asset) stays served; the frontend skips it
    // based on compatible:false.
    const js = await harness.app.request(
      `${BASE}${entry?.app.bundle?.jsUrl ?? ""}`,
    );
    expect(js.status).toBe(200);
  });

  it("refreshes the served bundle hash on reload-by-id after dist changes (bb plugin dev cycle)", async () => {
    // The P3.4 dev loop depends on exactly this: rebuild dist on disk, then
    // POST /plugins/reload?id=<id> must serve a fresh content hash so open
    // pages re-import the bundle. npm-style registration (handwritten dist,
    // current SDK meta) keeps the test off the slow esbuild path.
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-devy");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-devy" });
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(join(rootDir, "dist", "app.js"), "export default 1;\n");
    await writeFile(
      join(rootDir, "dist", "app.meta.json"),
      JSON.stringify({
        sdkMajor: PLUGIN_SDK_MAJOR,
        sdkVersion: PLUGIN_SDK_VERSION,
      }),
    );
    upsertInstalledPlugin(harness.db, {
      id: "devy",
      source: "npm:bb-plugin-devy@0.1.0",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await harness.pluginService.reload("devy");
    const before = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "devy")?.app.bundle;
    expect(before).not.toBeNull();

    await writeFile(join(rootDir, "dist", "app.js"), "export default 2;\n");
    const reload = await harness.app.request(
      `${BASE}/api/v1/plugins/reload?id=devy`,
      { method: "POST" },
    );
    expect(reload.status).toBe(200);

    const after = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "devy")?.app.bundle;
    expect(after).not.toBeNull();
    expect(after?.hash).not.toBe(before?.hash);
    expect(after?.jsUrl).toBe(
      `/api/v1/plugins/devy/assets/app.js?h=${after?.hash}`,
    );
    const js = await harness.app.request(`${BASE}${after?.jsUrl ?? ""}`);
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("export default 2");
  });

  it("clears the served bundle and sets a status detail when a required rebuild fails", async () => {
    const rootDir = join(
      harness.config.dataDir,
      "fixtures",
      "bb-plugin-brittle",
    );
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-brittle" });
    await harness.pluginService.installPath(rootDir);
    const before = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "brittle");
    expect(before?.app.bundle).not.toBeNull();

    // Stale meta forces a rebuild at the next load; the broken source makes
    // it fail. The stale dist must NOT keep being advertised/served.
    await writeFile(
      join(rootDir, "app.tsx"),
      "export default function App( {\n", // syntax error
    );
    await writeFile(
      join(rootDir, "dist", "app.meta.json"),
      JSON.stringify({ sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: "0.0.0-stale" }),
    );
    await harness.pluginService.reload("brittle");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "brittle");
    // Degraded-style: backend keeps running, detail explains the bundle.
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toContain("frontend bundle rebuild failed");
    expect(entry?.app).toEqual({ hasApp: true, bundle: null });
    const js = await harness.app.request(
      `${BASE}/api/v1/plugins/brittle/assets/app.js`,
    );
    expect(js.status).toBe(404);
  }, 120_000);

  it("re-keys the bundle hash when only the meta changes (same js/css)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-meta");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-meta" });
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(join(rootDir, "dist", "app.js"), "export default 1;\n");
    await writeFile(
      join(rootDir, "dist", "app.meta.json"),
      JSON.stringify({
        sdkMajor: PLUGIN_SDK_MAJOR,
        sdkVersion: PLUGIN_SDK_VERSION,
      }),
    );
    upsertInstalledPlugin(harness.db, {
      id: "meta",
      source: "npm:bb-plugin-meta@0.1.0",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await harness.pluginService.reload("meta");
    const before = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "meta")?.app.bundle;
    expect(before?.compatible).toBe(true);

    // Same js, no css — only the meta flips to an incompatible major. The
    // hash must change so the frontend's hash-keyed reconcile re-evaluates.
    const staleMajor = PLUGIN_SDK_MAJOR + 1;
    await writeFile(
      join(rootDir, "dist", "app.meta.json"),
      JSON.stringify({ sdkMajor: staleMajor, sdkVersion: `${staleMajor}.0.0` }),
    );
    await harness.pluginService.reload("meta");
    const after = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "meta")?.app.bundle;
    expect(after?.compatible).toBe(false);
    expect(after?.hash).not.toBe(before?.hash);
  });

  it("rejects malformed bundle meta (strict parse)", async () => {
    const rootDir = join(
      harness.config.dataDir,
      "fixtures",
      "bb-plugin-malformed",
    );
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-malformed" });
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(join(rootDir, "dist", "app.js"), "export default 1;\n");
    upsertInstalledPlugin(harness.db, {
      id: "malformed",
      source: "npm:bb-plugin-malformed@0.1.0",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    // The same parse gates npm install validation (registerInstalled uses
    // readPluginAppBundleMeta), so covering it here covers both boundaries.
    const badMetas = [
      { sdkMajor: -1, sdkVersion: "0.0.0" }, // negative major
      { sdkMajor: 0.5, sdkVersion: "0.5.0" }, // non-integer major
      { sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: "banana" }, // not semver
      // internally inconsistent: major field disagrees with the version
      { sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: `${PLUGIN_SDK_MAJOR + 1}.0.0` },
    ];
    for (const badMeta of badMetas) {
      await writeFile(
        join(rootDir, "dist", "app.meta.json"),
        JSON.stringify(badMeta),
      );
      await harness.pluginService.reload("malformed");
      const entry = harness.pluginService
        .list()
        .find((plugin) => plugin.id === "malformed");
      expect(entry?.app, JSON.stringify(badMeta)).toEqual({
        hasApp: true,
        bundle: null,
      });
    }
  });

  it("stops serving assets when the plugin is disabled", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-gated");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-gated" });
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(join(rootDir, "dist", "app.js"), "export default 1;\n");
    await writeFile(
      join(rootDir, "dist", "app.meta.json"),
      JSON.stringify({
        sdkMajor: PLUGIN_SDK_MAJOR,
        sdkVersion: PLUGIN_SDK_VERSION,
      }),
    );
    upsertInstalledPlugin(harness.db, {
      id: "gated",
      source: "npm:bb-plugin-gated@0.1.0",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await harness.pluginService.reload("gated");
    const bundle = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "gated")?.app.bundle;
    expect(bundle).not.toBeNull();
    const url = `${BASE}${bundle?.jsUrl ?? ""}`;
    expect((await harness.app.request(url)).status).toBe(200);

    await harness.pluginService.setEnabled("gated", false);
    expect((await harness.app.request(url)).status).toBe(404);

    await harness.pluginService.setEnabled("gated", true);
    expect((await harness.app.request(url)).status).toBe(200);
  });

  it("reports bundle:null when an npm plugin's dist is missing at load", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-bare");
    await writeAppPluginFixture(rootDir, { name: "bb-plugin-bare" });
    upsertInstalledPlugin(harness.db, {
      id: "bare",
      source: "npm:bb-plugin-bare@0.1.0",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await harness.pluginService.reload("bare");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "bare");
    expect(entry?.status).toBe("running");
    expect(entry?.app).toEqual({ hasApp: true, bundle: null });
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/bare/assets/app.js`,
    );
    expect(response.status).toBe(404);
  });

  describe.skipIf(!hasNpm)("npm install policy", () => {
    it(
      "refuses npm installs without a prebuilt bundle and accepts prebuilt ones",
      { timeout: 180_000 },
      async () => {
        const workDir = join(harness.config.dataDir, "npm-work");

        // Package 1: declares bb.app but ships no dist → refused.
        const noDistDir = join(workDir, "no-dist");
        await writeAppPluginFixture(noDistDir, { name: "bb-plugin-nodist" });

        // Package 2: ships a prebuilt dist stamped with the current SDK.
        const prebuiltDir = join(workDir, "prebuilt");
        await writeAppPluginFixture(prebuiltDir, { name: "bb-plugin-prebuilt" });
        await mkdir(join(prebuiltDir, "dist"), { recursive: true });
        await writeFile(
          join(prebuiltDir, "dist", "app.js"),
          "export default {};\n",
        );
        await writeFile(
          join(prebuiltDir, "dist", "app.meta.json"),
          JSON.stringify({
            sdkMajor: PLUGIN_SDK_MAJOR,
            sdkVersion: PLUGIN_SDK_VERSION,
          }),
        );

        const packDir = join(workDir, "pack");
        await mkdir(packDir, { recursive: true });
        const tarballs = new Map<string, Buffer>();
        for (const [name, dir] of [
          ["bb-plugin-nodist", noDistDir],
          ["bb-plugin-prebuilt", prebuiltDir],
        ] as const) {
          await run("npm", ["pack", "--pack-destination", packDir], {
            cwd: dir,
          });
          tarballs.set(name, await readFile(join(packDir, `${name}-0.1.0.tgz`)));
        }

        // Minimal loopback npm registry (packument + tarball per package).
        const registry = await new Promise<Server>((resolvePromise) => {
          const server = createServer((request, response) => {
            const url = request.url ?? "";
            for (const [name, tarball] of tarballs) {
              if (url === `/${name}/-/${name}-0.1.0.tgz`) {
                response.writeHead(200, {
                  "content-type": "application/octet-stream",
                });
                response.end(tarball);
                return;
              }
              if (url === `/${name}`) {
                const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
                response.writeHead(200, {
                  "content-type": "application/json",
                });
                response.end(
                  JSON.stringify({
                    name,
                    "dist-tags": { latest: "0.1.0" },
                    versions: {
                      "0.1.0": {
                        name,
                        version: "0.1.0",
                        dist: {
                          tarball: `${origin}/${name}/-/${name}-0.1.0.tgz`,
                          shasum: createHash("sha1")
                            .update(tarball)
                            .digest("hex"),
                          integrity: `sha512-${createHash("sha512")
                            .update(tarball)
                            .digest("base64")}`,
                        },
                      },
                    },
                  }),
                );
                return;
              }
            }
            response.writeHead(404);
            response.end();
          });
          server.listen(0, "127.0.0.1", () => resolvePromise(server));
        });
        const port = (registry.address() as AddressInfo).port;
        const previousRegistry = process.env.npm_config_registry;
        const previousCache = process.env.npm_config_cache;
        process.env.npm_config_registry = `http://127.0.0.1:${port}`;
        process.env.npm_config_cache = join(workDir, "npm-cache");
        try {
          await expect(
            harness.pluginService.install("npm:bb-plugin-nodist@0.1.0"),
          ).rejects.toThrowError(/must publish a prebuilt bundle/);
          // The refused install cleaned up its managed prefix and row.
          expect(harness.pluginService.list()).toHaveLength(0);
          const prefix = join(
            harness.config.dataDir,
            "plugins",
            "npm",
            "bb-plugin-nodist@0.1.0",
          );
          await expect(stat(prefix)).rejects.toThrowError();

          const entry = await harness.pluginService.install(
            "npm:bb-plugin-prebuilt@0.1.0",
          );
          expect(entry.status).toBe("running");
          expect(entry.app.hasApp).toBe(true);
          expect(entry.app.bundle).toMatchObject({
            sdkMajor: PLUGIN_SDK_MAJOR,
            sdkVersion: PLUGIN_SDK_VERSION,
            compatible: true,
          });
        } finally {
          if (previousRegistry === undefined) {
            delete process.env.npm_config_registry;
          } else {
            process.env.npm_config_registry = previousRegistry;
          }
          if (previousCache === undefined) {
            delete process.env.npm_config_cache;
          } else {
            process.env.npm_config_cache = previousCache;
          }
          await new Promise<void>((resolvePromise) =>
            registry.close(() => resolvePromise()),
          );
        }
      },
    );
  });
});
