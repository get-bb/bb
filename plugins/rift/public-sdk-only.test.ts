import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly as scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

const scan = scanPublicSdkOnly(dirname(fileURLToPath(import.meta.url)), {
  allow: [/^react$/u, /^(?:\.\.\/)+vitest\.shared\.js$/u],
});

describe("rift imports only the public SDK", () => {
  it("scans the plugin entries", () => {
    expect(scan.files).toContain("server.ts");
    expect(scan.files).toContain("app.tsx");
    expect(scan.files).toContain(join("src", "host.ts"));
  });

  it("stays inside the public allowlist", () => {
    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});
