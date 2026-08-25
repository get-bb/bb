/**
 * The first-party ACP plugin has no privilege: it reaches every capability
 * through the public SDK alone, exactly as a third-party ACP plugin (Amp)
 * would. No file in this package may import a private `@bb/*` workspace
 * package — not the plugin code, not the tests — and plugin code may import
 * only `@get-bb/plugin-sdk` (and its published subpaths), `zod`, node
 * built-ins, its own files, and the two public parsers below; tests may add
 * the published testing kit and the test runner. This is the same guard the
 * echo-provider canary carries (#2189), run by the published testing kit.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly as scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

const scan = scanPublicSdkOnly(dirname(fileURLToPath(import.meta.url)), {
  allow: [
    // The public parsers the host entry reads omp's, hermes's and grok's
    // config files with; any plugin can depend on them.
    /^yaml$/u,
    /^smol-toml$/u,
    // The one path that leaves this package: vitest.config.ts reads the
    // monorepo's shared test config.
    /^(?:\.\.\/)+vitest\.shared\.js$/u,
  ],
});

describe("provider-acp imports only the public SDK", () => {
  it("scans the plugin's source files", () => {
    expect(scan.files).toContain("server.ts");
    expect(scan.files).toContain(join("src", "host.ts"));
  });

  it("has no @bb/* import and stays inside the allowlist", () => {
    expect(scan.violations).toEqual([]);
  });

  it("declares no @bb/* dependency in package.json", () => {
    expect(scan.privateDependencies).toEqual([]);
  });
});
