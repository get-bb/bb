import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_scanPublicSdkOnly as scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

const scan = scanPublicSdkOnly(dirname(fileURLToPath(import.meta.url)), {
  allow: [
    /^(?:\.\.\/)+vitest\.shared\.js$/u,
    /^undici$/u,
    /^zod$/u,
    /^react$/u,
    /^@testing-library\/react$/u,
  ],
});

describe("push-notifications public SDK boundary", () => {
  it("uses only public SDK and declared dependencies", () => {
    expect(scan.violations).toEqual([]);
  });

  it("allows only the bundled build tool as a private dev dependency", () => {
    expect(scan.privateDependencies).toEqual(["@bb/plugin-build"]);
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    );
    expect(manifest).toMatchObject({
      devDependencies: { "@bb/plugin-build": "workspace:*" },
    });
  });
});
