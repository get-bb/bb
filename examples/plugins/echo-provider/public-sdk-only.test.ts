/**
 * The rule this example exists to prove: a third-party provider plugin
 * reaches EVERY capability through the public SDK alone. No file in this
 * package may import a private `@bb/*` workspace package — not the plugin
 * code, not the tests — and plugin code may import only `@get-bb/plugin-sdk`
 * (and its published subpaths), `zod`, node built-ins, and its own files;
 * tests may add the published test harnesses and the test runner. The
 * published testing kit scans for exactly that.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly as scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

const scan = scanPublicSdkOnly(dirname(fileURLToPath(import.meta.url)), {
  // The one path that leaves this package: vitest.config.ts reads the
  // monorepo's shared test config. A marketplace copy of this plugin has its
  // own config; the escape is named here so the scan admits nothing else.
  allow: [/^(?:\.\.\/)+vitest\.shared\.js$/u],
});

describe("echo-provider imports only the public SDK", () => {
  it("scans the plugin's source files", () => {
    expect(scan.files).toContain("server.ts");
    expect(scan.files).toContain("host.ts");
    expect(scan.files).toContain(join("src", "provider-bridge.ts"));
  });

  it("has no @bb/* import and stays inside the allowlist", () => {
    expect(scan.violations).toEqual([]);
  });

  it("declares no @bb/* dependency in package.json", () => {
    expect(scan.privateDependencies).toEqual([]);
  });
});
