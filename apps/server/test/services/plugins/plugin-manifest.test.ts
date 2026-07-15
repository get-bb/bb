import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPluginManifest } from "../../../src/services/plugins/manifest.js";

describe("plugin manifest", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "bb-plugin-manifest-"));
    await writeFile(join(rootDir, "server.ts"), "export default () => {};\n");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const validBb = {
    name: "Contract fixture",
    description: "Plugin manifest contract fixture.",
    branding: { icon: "Zap" },
    server: "./server.ts",
  };

  async function writeManifest(
    bbPluginSdk?: string,
    bb: Record<string, unknown> = validBb,
  ): Promise<void> {
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-contract",
        version: "2.3.4",
        ...(bbPluginSdk === undefined ? {} : { engines: { bbPluginSdk } }),
        bb,
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

  it.each(["name", "description"] as const)(
    "requires a non-empty bb.%s string",
    async (field: "name" | "description") => {
      const { [field]: _omitted, ...withoutField } = validBb;
      await writeManifest(undefined, withoutField);
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        new RegExp(`bb\\.${field}`),
      );

      await writeManifest(undefined, { ...validBb, [field]: "   " });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        new RegExp(`bb\\.${field}`),
      );

      await writeManifest(undefined, { ...validBb, [field]: null });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        new RegExp(`bb\\.${field}`),
      );
    },
  );

  it("requires branding with either an icon or a light logo", async () => {
    for (const branding of [undefined, null, {}, { icon: "   " }]) {
      await writeManifest(undefined, { ...validBb, branding });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(/bb\.branding/);
    }
  });

  it("rejects a dark logo without a light logo", async () => {
    await writeManifest(undefined, {
      ...validBb,
      branding: { logo: { dark: "./dark.svg" } },
    });
    await expect(readPluginManifest(rootDir)).rejects.toThrow(
      /bb\.branding\.logo\.light/,
    );
  });

  it("rejects null and empty branding asset paths", async () => {
    for (const light of [null, "   "]) {
      await writeManifest(undefined, {
        ...validBb,
        branding: { logo: { light } },
      });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        /bb\.branding\.logo\.light/,
      );
    }
    for (const dark of [null, "   "]) {
      await writeManifest(undefined, {
        ...validBb,
        branding: { logo: { light: "./light.svg", dark } },
      });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        /bb\.branding\.logo\.dark/,
      );
    }
  });

  it.each([
    ["displayName", "Legacy name"],
    ["icon", "Zap"],
    ["logo", "./logo.svg"],
    ["logoDark", "./logo-dark.svg"],
  ])(
    "rejects the legacy bb.%s field instead of ignoring it",
    async (field, value) => {
      await writeManifest(undefined, { ...validBb, [field]: value });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        /unrecognized key/i,
      );
    },
  );

  it("requires declared logo assets to be supported files", async () => {
    await writeManifest(undefined, {
      ...validBb,
      branding: { logo: { light: "./missing.svg" } },
    });
    await expect(readPluginManifest(rootDir)).rejects.toThrow(/missing file/);

    await mkdir(join(rootDir, "directory.svg"));
    await writeManifest(undefined, {
      ...validBb,
      branding: { logo: { light: "./directory.svg" } },
    });
    await expect(readPluginManifest(rootDir)).rejects.toThrow(
      /point at a file/,
    );

    await writeManifest(undefined, {
      ...validBb,
      branding: { logo: { light: "./logo.gif" } },
    });
    await expect(readPluginManifest(rootDir)).rejects.toThrow(
      /\.svg, \.png, or \.webp/,
    );
  });

  it("rejects a branding asset symlink that escapes the plugin directory", async () => {
    const outsideDir = await mkdtemp(
      join(tmpdir(), "bb-plugin-branding-outside-"),
    );
    try {
      const outsideAsset = join(outsideDir, "outside.svg");
      await writeFile(outsideAsset, "<svg/>");
      await symlink(outsideAsset, join(rootDir, "linked.svg"));
      await writeManifest(undefined, {
        ...validBb,
        branding: { logo: { light: "./linked.svg" } },
      });
      await expect(readPluginManifest(rootDir)).rejects.toThrow(
        /escapes the plugin directory through a symlink/,
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
