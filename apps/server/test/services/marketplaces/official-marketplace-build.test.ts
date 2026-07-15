import { cp, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { buildPluginApp, buildPluginServer } from "@bb/plugin-build";
import semver from "semver";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { OFFICIAL_MARKETPLACE_CATALOG } from "../../../src/services/marketplaces/official-marketplace.js";
import {
  parsePluginArtifactMeta,
  validatePluginArtifactMeta,
} from "../../../src/services/plugins/app-bundle.js";
import { readPluginManifest } from "../../../src/services/plugins/manifest.js";

const BB_BUILD_VERSION = "0.9.0-test";
const repositoryRoot = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);
const pluginDirectories = new Map([
  ["github", "marketplace/plugins/github"],
  ["simple-notes", "marketplace/plugins/docs"],
  ["memory", "marketplace/plugins/memory"],
]);
const releaseNames = new Map([
  ["github", "github"],
  ["simple-notes", "docs"],
  ["memory", "memory"],
]);
const publishablePackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  private: z.literal(true),
  files: z.array(z.string()),
  repository: z.object({
    type: z.literal("git"),
    url: z.literal("git+https://github.com/ymichael/bb.git"),
    directory: z.string(),
  }),
});

function sourceRootFor(pluginId: string): string {
  const directory = pluginDirectories.get(pluginId);
  if (directory === undefined) {
    throw new Error(`missing local directory for official plugin ${pluginId}`);
  }
  return join(repositoryRoot, directory);
}

vi.setConfig({ testTimeout: 120_000 });

it("builds every BB Official plugin with authoritative artifact metadata", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "bb-official-build-"));
  try {
    for (const entry of OFFICIAL_MARKETPLACE_CATALOG.plugins) {
      const sourceRoot = sourceRootFor(entry.id);
      const buildRoot = join(temporaryRoot, entry.id);
      await expect(stat(join(sourceRoot, "dist"))).rejects.toThrow();
      await cp(sourceRoot, buildRoot, {
        recursive: true,
        filter: (source) => {
          const name = basename(source);
          return name !== "dist" && name !== "node_modules";
        },
      });
      await symlink(
        join(sourceRoot, "node_modules"),
        join(buildRoot, "node_modules"),
        "dir",
      );

      const manifest = await readPluginManifest(buildRoot);
      expect(manifest).toMatchObject({
        id: entry.id,
        name: entry.displayName,
      });
      const packageJsonInput: unknown = JSON.parse(
        await readFile(join(buildRoot, "package.json"), "utf8"),
      );
      const packageJson = publishablePackageSchema.parse(packageJsonInput);
      expect(packageJson.files).toContain("dist");
      expect(sourceRoot).toBe(
        join(repositoryRoot, packageJson.repository.directory),
      );
      const releaseName = releaseNames.get(entry.id);
      if (releaseName === undefined) {
        throw new Error(`missing release name for official plugin ${entry.id}`);
      }
      expect(entry.source).toEqual({
        githubRelease: {
          repository: "ymichael/bb",
          package: packageJson.name,
          range: `^${packageJson.version}`,
          tagTemplate: `plugin-${releaseName}-v{version}`,
          assetTemplate: `${packageJson.name}-{version}.tgz`,
        },
      });
      if (!("githubRelease" in entry.source)) {
        throw new Error(
          `official plugin ${entry.id} must use a GitHub Release source`,
        );
      }
      expect(
        semver.satisfies(manifest.version, entry.source.githubRelease.range),
      ).toBe(true);

      const serverBuild = await buildPluginServer(buildRoot, BB_BUILD_VERSION);
      const appBuild = await buildPluginApp(buildRoot, BB_BUILD_VERSION);
      for (const artifact of [
        { kind: "server" as const, ...serverBuild },
        { kind: "app" as const, ...appBuild },
      ]) {
        const raw = await readFile(artifact.metaPath, "utf8");
        expect(
          validatePluginArtifactMeta({
            artifact: artifact.kind,
            raw,
            pluginId: manifest.id,
            pluginVersion: manifest.version,
          }),
        ).toBeNull();
        expect(parsePluginArtifactMeta(raw)).toEqual({
          error: null,
          meta: {
            sdkMajor: PLUGIN_SDK_MAJOR,
            sdkVersion: PLUGIN_SDK_VERSION,
            artifactFormatVersion: 1,
            pluginId: manifest.id,
            pluginVersion: manifest.version,
            builtWith: {
              bbVersion: BB_BUILD_VERSION,
              pluginSdkVersion: PLUGIN_SDK_VERSION,
            },
          },
        });
        expect((await stat(artifact.jsPath)).size).toBeGreaterThan(0);
      }

      await expect(stat(join(sourceRoot, "dist"))).rejects.toThrow();
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
