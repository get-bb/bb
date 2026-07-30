import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { loadPluginBrandingAssets } from "../../../src/services/plugins/app-bundle.js";

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
    logoLight?: string;
    logoDark?: string;
    pluginName?: string;
    brandingIcon?: string | null;
  },
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: options.pluginName ?? "Logo fixture",
        description: "Plugin branding fixture.",
        branding: {
          ...(options.brandingIcon === null
            ? {}
            : { icon: options.brandingIcon ?? "Zap" }),
          ...(options.logoLight === undefined && options.logoDark === undefined
            ? {}
            : {
                logo: {
                  ...(options.logoLight === undefined
                    ? {}
                    : { light: options.logoLight }),
                  ...(options.logoDark === undefined
                    ? {}
                    : { dark: options.logoDark }),
                },
              }),
        },
        server: "./server.ts",
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

describe("plugin branding assets (manifest, asset route, inventory)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("serves a path-shaped branding.icon as a hashed compact SVG asset", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-mark");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-mark",
      brandingIcon: "./assets/icon.svg",
      files: { "assets/icon.svg": SVG_LOGO },
    });

    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.icon).toBe("./assets/icon.svg");
    expect(entry.iconUrl).toMatch(
      /^\/api\/v1\/plugins\/mark\/assets\/icon\?h=[0-9a-f]{16}$/,
    );

    const icon = await harness.app.request(`${BASE}${entry.iconUrl}`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(icon.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await icon.text()).toBe(SVG_LOGO);

    const disabled = await harness.pluginService.setEnabled("mark", false);
    expect(disabled?.iconUrl).toBe(entry.iconUrl);
    const disabledIcon = await harness.app.request(
      `${BASE}${disabled?.iconUrl}`,
    );
    expect(disabledIcon.status).toBe(200);
  });

  it("validates the exact compact icon bytes before snapshotting them", async () => {
    const iconPath = join(harness.config.dataDir, "mutable-icon.svg");
    await writeFile(iconPath, "<html/>");

    await expect(
      loadPluginBrandingAssets("mutable", {
        branding: { compactIconPath: iconPath },
      }),
    ).rejects.toThrow(/<svg> root element/);
  });

  it("serves an explicit light SVG hash-cached as image/svg+xml", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoa");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoa",
      logoLight: "./logo.svg",
      files: { "logo.svg": SVG_LOGO, "logo.png": PNG_STUB },
    });

    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.logoUrl).toMatch(
      /^\/api\/v1\/plugins\/logoa\/assets\/logo\?h=[0-9a-f]{16}$/,
    );

    // The explicitly declared SVG determines the content type and bytes.
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

  it("serves an explicit PNG as image/png", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logob");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logob",
      logoLight: "./logo.png",
      files: { "logo.png": PNG_STUB },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const logo = await harness.app.request(`${BASE}${entry.logoUrl}`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
  });

  it("honors a relocated bb.branding.logo.light webp", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoc");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoc",
      logoLight: "./assets/mark.webp",
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

  it("rejects a light logo that escapes the plugin directory", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logod");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logod",
      logoLight: "../outside.svg",
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(
      /bb\.branding\.logo\.light escapes the plugin directory/,
    );
  });

  it("rejects a light logo with an unsupported extension", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoe");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoe",
      logoLight: "./logo.gif",
      files: { "logo.gif": PNG_STUB },
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(
      /bb\.branding\.logo\.light must point at a \.svg, \.png, or \.webp file/,
    );
  });

  it("does not auto-detect an undeclared root logo", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logof");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logof",
      files: { "logo.svg": SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    expect(entry.logoUrl).toBeNull();
    const logo = await harness.app.request(
      `${BASE}/api/v1/plugins/logof/assets/logo`,
    );
    expect(logo.status).toBe(404);
  });

  it("keeps advertising and serving both logos when the plugin is disabled", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logog");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logog",
      logoLight: "./logo.svg",
      logoDark: "./logo-dark.svg",
      files: { "logo.svg": SVG_LOGO, "logo-dark.svg": DARK_SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const logoUrl = entry.logoUrl;
    const logoDarkUrl = entry.logoDarkUrl;
    expect(logoUrl).not.toBeNull();
    expect(logoDarkUrl).not.toBeNull();

    // A logo is identity, not runtime: disabling keeps it advertised and
    // served (from the static-identity cache), so the list still recognizes
    // the plugin.
    const disabled = await harness.pluginService.setEnabled("logog", false);
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.logoUrl).toBe(logoUrl);
    expect(disabled?.logoDarkUrl).toBe(logoDarkUrl);
    const logo = await harness.app.request(`${BASE}${logoUrl}`);
    expect(logo.status).toBe(200);
    expect(await logo.text()).toBe(SVG_LOGO);
    const dark = await harness.app.request(`${BASE}${logoDarkUrl}`);
    expect(dark.status).toBe(200);
    expect(await dark.text()).toBe(DARK_SVG_LOGO);

    // Re-enabling keeps the same hash-stable URLs.
    const enabled = await harness.pluginService.setEnabled("logog", true);
    expect(enabled?.logoUrl).toBe(logoUrl);
    expect(enabled?.logoDarkUrl).toBe(logoDarkUrl);
  });

  it("keeps a disabled plugin's manifest name and icon in the inventory", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-ident");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-ident",
      pluginName: "Identity Demo",
      brandingIcon: "Brain",
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.name).toBe("Identity Demo");
    expect(entry.icon).toBe("Brain");
    expect(entry.iconUrl).toBeNull();

    const disabled = await harness.pluginService.setEnabled("ident", false);
    expect(disabled?.enabled).toBe(false);
    // Identity survives the runtime going away.
    expect(disabled?.name).toBe("Identity Demo");
    expect(disabled?.icon).toBe("Brain");
    expect(disabled?.logoUrl).toBe(entry.logoUrl);
  });

  it("drops a removed plugin's identity (logo 404s after uninstall)", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-gone");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-gone",
      logoLight: "./logo.svg",
      files: { "logo.svg": SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const logoUrl = entry.logoUrl;
    expect(logoUrl).not.toBeNull();

    await harness.pluginService.remove("gone");
    const logo = await harness.app.request(`${BASE}${logoUrl}`);
    expect(logo.status).toBe(404);
  });

  it("serves immutable snapshot bytes until reload refreshes the hash", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-logoh");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-logoh",
      logoLight: "./logo.svg",
      files: { "logo.svg": SVG_LOGO },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    const firstUrl = entry.logoUrl;
    expect(firstUrl).not.toBeNull();

    const changed = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>`;
    await writeFile(join(rootDir, "logo.svg"), changed);

    // The hashed URL identifies the bytes captured at load time. Mutating the
    // source file cannot change a response advertised as immutable.
    const original = await harness.app.request(`${BASE}${firstUrl}`);
    expect(original.status).toBe(200);
    expect(await original.text()).toBe(SVG_LOGO);
    expect(original.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );

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

  it("serves an explicit dark SVG as image/svg+xml", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darka");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darka",
      logoLight: "./logo.svg",
      logoDark: "./logo-dark.svg",
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

    // The explicitly declared SVG determines the content type and bytes.
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

  it("serves an explicit dark PNG as image/png", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkb");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkb",
      logoLight: "./logo.svg",
      logoDark: "./logo-dark.png",
      files: { "logo.svg": SVG_LOGO, "logo-dark.png": PNG_STUB },
    });
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.logoUrl).not.toBeNull();
    const dark = await harness.app.request(`${BASE}${entry.logoDarkUrl}`);
    expect(dark.status).toBe(200);
    expect(dark.headers.get("content-type")).toBe("image/png");
  });

  it("honors a relocated bb.branding.logo.dark webp", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkc");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkc",
      logoLight: "./logo.svg",
      logoDark: "./assets/mark-dark.webp",
      files: {
        "logo.svg": SVG_LOGO,
        // An undeclared root file is ignored.
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

  it("rejects a dark logo that escapes the plugin directory", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkd");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkd",
      logoLight: "./logo.svg",
      logoDark: "../outside-dark.svg",
      files: { "logo.svg": SVG_LOGO },
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(
      /bb\.branding\.logo\.dark escapes the plugin directory/,
    );
  });

  it("rejects a dark logo with an unsupported extension", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darke");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darke",
      logoLight: "./logo.svg",
      logoDark: "./logo-dark.gif",
      files: { "logo.svg": SVG_LOGO, "logo-dark.gif": PNG_STUB },
    });
    await expect(
      harness.pluginService.installPath(rootDir),
    ).rejects.toThrowError(
      /bb\.branding\.logo\.dark must point at a \.svg, \.png, or \.webp file/,
    );
  });

  it("reports logoDarkUrl null and 404s the dark asset when only a light logo ships", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "bb-plugin-darkf");
    await writeLogoPluginFixture(rootDir, {
      name: "bb-plugin-darkf",
      logoLight: "./logo.svg",
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
      logoLight: "./logo.svg",
      logoDark: "./logo-dark.svg",
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
