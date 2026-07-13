import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPluginManifest } from "../../../src/services/plugins/manifest.js";

describe("plugin manifest SDK range", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "bb-plugin-manifest-"));
    await writeFile(join(rootDir, "server.ts"), "export default () => {};\n");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function writeManifest(bbPluginSdk?: string): Promise<void> {
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-contract",
        version: "2.3.4",
        ...(bbPluginSdk === undefined ? {} : { engines: { bbPluginSdk } }),
        bb: { server: "./server.ts" },
      }),
    );
  }

  it("accepts a valid engines.bbPluginSdk range", async () => {
    await writeManifest("^0.2.0 || >=2.0.0");
    expect((await readPluginManifest(rootDir)).bbPluginSdkRange).toBe(
      "^0.2.0 || >=2.0.0",
    );
  });

  it("rejects an invalid engines.bbPluginSdk range clearly", async () => {
    await writeManifest("definitely not semver");
    await expect(readPluginManifest(rootDir)).rejects.toThrow(
      /engines\.bbPluginSdk.*valid semver range/,
    );
  });

  it("accepts an absent range as a legacy manifest", async () => {
    await writeManifest();
    expect(
      (await readPluginManifest(rootDir)).bbPluginSdkRange,
    ).toBeUndefined();
  });
});
