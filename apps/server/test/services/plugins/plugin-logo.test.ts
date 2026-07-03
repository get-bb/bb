import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

// Same origin trick as the app-bundle tests: the harness config's serverPort
// puts this host on the local-app origin allowlist.
const BASE = "http://127.0.0.1:3334";

const SERVER_SOURCE = `export default function plugin(bb: any) { bb.log.info("loaded"); }`;
const SVG_LOGO = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>`;
const DARK_SVG_LOGO = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff" width="4" height="4"/></svg>`;
const PNG_STUB = Buffer.from("89504e470d0a1a0a", "hex"); // magic bytes only
const WEBP_STUB = Buffer.from("52494646", "hex");

async function writeLogoPluginFixture(
  rootDir: string,
  options: {
    name: string;
    files?: Record<string, string | Buffer>;
    bbLogo?: string;
    bbLogoDark?: string;
  },
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        server: "./server.ts",
        ...(options.bbLogo !== undefined ? { logo: options.bbLogo } : {}),
        ...(options.bbLogoDark !== undefined
          ? { logoDark: options.bbLogoDark }
          : {}),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), SERVER_SOURCE);
  for (const [relative, contents] of Object.entries(options.files ?? {})) {
    const path = join(rootDir, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
}

describe("plugin logos (detection, manifest override, asset route, inventory)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("detects logo.svg over logo.png and serves it hash-cached as image/svg+xml", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoa");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoa",
      files: { "logo.svg": SVG_LOGO, "logo.png": PNG_STUB },
    });

    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.logoUrl).toMatch(
      /^\/api\/v1\/plugins\/logoa\/assets\/logo\?h=[0-9a-f]{16}$/,
    );

    // svg beat png: correct content type + bytes.
    const logo = await harness.app.request(`${BASE}${entry.logoUrl}`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/svg+xml");
    expect(logo.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await logo.text()).toBe(SVG_LOGO);

    // Wrong/absent hash still serves current bytes, but uncached.
    const noHash = await harness.app.request(
      `${BASE}/api/v1/plugins/logoa/assets/logo`,
    );
    expect(noHash.status).toBe(200);
    expect(noHash.headers.get("cache-control")).toBe("no-store");
  });

  it("serves logo.png as image/png when no svg exists", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logob");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logob",
      files: { "logo.png": PNG_STUB },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const logo = await harness.app.request(`${BASE}${entry.logoUrl}`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
  });

  it("honors the bb.logo manifest override (relocated webp)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoc");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoc",
      bbLogo: "./assets/mark.webp",
      files: {
        // The convention file is present but the override wins.
        "logo.svg": SVG_LOGO,
        "assets/mark.webp": WEBP_STUB,
      },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    const logo = await harness.app.request(`${BASE}${entry.logoUrl}`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/webp");
  });

  it("rejects a bb.logo that escapes the plugin directory (install fails)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logod");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logod",
      bbLogo: "../outside.svg",
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(/bb\.logo escapes the plugin directory/);
  });

  it("rejects a bb.logo with an unsupported extension (install fails)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoe");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoe",
      bbLogo: "./logo.gif",
      files: { "logo.gif": PNG_STUB },
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(/bb\.logo must point at a \.svg, \.png, or \.webp file/);
  });

  it("reports logoUrl null and 404s the asset for logo-less plugins", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logof");
    await writeLogoPluginFixture(rootDir, { name: "bb-plugin-logof" });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.logoUrl).toBeNull();
    const logo = await harness.app.request(
      `${BASE}/api/v1/plugins/logof/assets/logo`,
    );
    expect(logo.status).toBe(404);
  });

  it("stops advertising and serving both logos when the plugin is disabled", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logog");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logog",
      files: { "logo.svg": SVG_LOGO, "logo-dark.svg": DARK_SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const logoUrl = entry.logoUrl;
    const logoDarkUrl = entry.logoDarkUrl;
    expect(logoUrl).not.toBeNull();
    expect(logoDarkUrl).not.toBeNull();

    const disabled = await harness.pluginService.setEnabled("logog", false);
    expect(disabled?.logoUrl).toBeNull();
    expect(disabled?.logoDarkUrl).toBeNull();
    const logo = await harness.app.request(`${BASE}${logoUrl}`);
    expect(logo.status).toBe(404);
    const dark = await harness.app.request(`${BASE}${logoDarkUrl}`);
    expect(dark.status).toBe(404);

    // Re-enabling brings both back.
    const enabled = await harness.pluginService.setEnabled("logog", true);
    expect(enabled?.logoUrl).toBe(logoUrl);
    expect(enabled?.logoDarkUrl).toBe(logoDarkUrl);
  });

  it("refreshes the logo hash on reload after the file changes", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoh");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoh",
      files: { "logo.svg": SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const firstUrl = entry.logoUrl;
    expect(firstUrl).not.toBeNull();

    const changed = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>`;
    await writeFile(join(rootDir, "logo.svg"), changed);
    await harness.pluginService.reload("logoh");

    const reloaded = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "logoh");
    expect(reloaded?.logoUrl).not.toBeNull();
    expect(reloaded?.logoUrl).not.toBe(firstUrl);

    const logo = await harness.app.request(`${BASE}${reloaded?.logoUrl}`);
    expect(logo.status).toBe(200);
    expect(await logo.text()).toBe(changed);
    expect(logo.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("detects logo-dark.svg over logo-dark.png and serves it as image/svg+xml", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darka");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darka",
      files: {
        "logo.svg": SVG_LOGO,
        "logo-dark.svg": DARK_SVG_LOGO,
        "logo-dark.png": PNG_STUB,
      },
    });

    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.logoUrl).toMatch(
      /^\/api\/v1\/plugins\/darka\/assets\/logo\?h=[0-9a-f]{16}$/,
    );
    expect(entry.logoDarkUrl).toMatch(
      /^\/api\/v1\/plugins\/darka\/assets\/logo-dark\?h=[0-9a-f]{16}$/,
    );

    // svg beat png: correct content type + bytes, hash-cached.
    const dark = await harness.app.request(`${BASE}${entry.logoDarkUrl}`);
    expect(dark.status).toBe(200);
    expect(dark.headers.get("content-type")).toBe("image/svg+xml");
    expect(dark.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await dark.text()).toBe(DARK_SVG_LOGO);

    // Wrong/absent hash still serves current bytes, but uncached.
    const noHash = await harness.app.request(
      `${BASE}/api/v1/plugins/darka/assets/logo-dark`,
    );
    expect(noHash.status).toBe(200);
    expect(noHash.headers.get("cache-control")).toBe("no-store");
  });

  it("serves logo-dark.png as image/png when no dark svg exists", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkb");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkb",
      files: { "logo-dark.png": PNG_STUB },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    // A dark-only plugin advertises no light logoUrl.
    expect(entry.logoUrl).toBeNull();
    const dark = await harness.app.request(`${BASE}${entry.logoDarkUrl}`);
    expect(dark.status).toBe(200);
    expect(dark.headers.get("content-type")).toBe("image/png");
  });

  it("honors the bb.logoDark manifest override (relocated webp)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkc");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkc",
      bbLogoDark: "./assets/mark-dark.webp",
      files: {
        // The convention file is present but the override wins.
        "logo-dark.svg": DARK_SVG_LOGO,
        "assets/mark-dark.webp": WEBP_STUB,
      },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    const dark = await harness.app.request(`${BASE}${entry.logoDarkUrl}`);
    expect(dark.status).toBe(200);
    expect(dark.headers.get("content-type")).toBe("image/webp");
  });

  it("rejects a bb.logoDark that escapes the plugin directory (install fails)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkd");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkd",
      bbLogoDark: "../outside-dark.svg",
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(/bb\.logoDark escapes the plugin directory/);
  });

  it("rejects a bb.logoDark with an unsupported extension (install fails)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darke");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darke",
      bbLogoDark: "./logo-dark.gif",
      files: { "logo-dark.gif": PNG_STUB },
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(
      /bb\.logoDark must point at a \.svg, \.png, or \.webp file/,
    );
  });

  it("reports logoDarkUrl null and 404s the dark asset when only a light logo ships", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkf");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkf",
      files: { "logo.svg": SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.logoUrl).not.toBeNull();
    expect(entry.logoDarkUrl).toBeNull();
    const dark = await harness.app.request(
      `${BASE}/api/v1/plugins/darkf/assets/logo-dark`,
    );
    expect(dark.status).toBe(404);
  });

  it("refreshes the dark logo hash on reload after the file changes", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkg");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkg",
      files: { "logo.svg": SVG_LOGO, "logo-dark.svg": DARK_SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const firstUrl = entry.logoDarkUrl;
    const firstLightUrl = entry.logoUrl;
    expect(firstUrl).not.toBeNull();

    const changed = `<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#fff" r="2"/></svg>`;
    await writeFile(join(rootDir, "logo-dark.svg"), changed);
    await harness.pluginService.reload("darkg");

    const reloaded = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "darkg");
    expect(reloaded?.logoDarkUrl).not.toBeNull();
    expect(reloaded?.logoDarkUrl).not.toBe(firstUrl);
    // The untouched light logo keeps its URL.
    expect(reloaded?.logoUrl).toBe(firstLightUrl);

    const dark = await harness.app.request(`${BASE}${reloaded?.logoDarkUrl}`);
    expect(dark.status).toBe(200);
    expect(await dark.text()).toBe(changed);
  });
});
