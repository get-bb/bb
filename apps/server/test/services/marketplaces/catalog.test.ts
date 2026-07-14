import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  catalogEntrySourceDisplay,
  marketplacePolicyWideningProblem,
  parseMarketplaceCatalog,
  resolvedCatalogEntrySource,
  validateMarketplaceCatalogRealPaths,
} from "../../../src/services/marketplaces/catalog.js";
import { parseGithubReleaseRegistryUrl } from "../../../src/services/plugins/github-release-source.js";

function catalog(source: unknown) {
  return {
    schemaVersion: 1,
    name: "test",
    displayName: "Test",
    plugins: [
      {
        id: "notes",
        displayName: "Notes",
        description: "Notes plugin",
        source,
      },
    ],
  };
}

describe("marketplace catalog validation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-marketplace-catalog-"));
    await mkdir(join(root, "plugins", "notes"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports an unknown schema version clearly", () => {
    expect(() =>
      parseMarketplaceCatalog(
        {
          ...catalog({ npm: { package: "bb-plugin-notes" } }),
          schemaVersion: 2,
        },
        "git",
        root,
      ),
    ).toThrow(/unknown marketplace catalog schemaVersion 2/);
  });

  it("allows contained local paths only for path marketplaces", () => {
    expect(
      parseMarketplaceCatalog(catalog({ path: "plugins/notes" }), "path", root)
        .plugins,
    ).toHaveLength(1);
    expect(() =>
      parseMarketplaceCatalog(catalog({ path: "../notes" }), "path", root),
    ).toThrow(/escapes the marketplace root/);
    expect(() =>
      parseMarketplaceCatalog(
        catalog({ path: join(root, "plugins", "notes") }),
        "path",
        root,
      ),
    ).toThrow(/must be relative/);
    expect(() =>
      parseMarketplaceCatalog(catalog({ path: "plugins/notes" }), "git", root),
    ).toThrow(/remote entry.*local path/);
  });

  it("rejects a local path entry whose symlink resolves outside the marketplace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bb-marketplace-outside-"));
    try {
      await symlink(outside, join(root, "plugins", "escape"));
      const parsed = parseMarketplaceCatalog(
        catalog({ path: "plugins/escape" }),
        "path",
        root,
      );
      await expect(
        validateMarketplaceCatalogRealPaths(parsed, "path", root),
      ).rejects.toThrow(/resolves outside its root/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("accepts narrowing compatibility policy and rejects widening policy", () => {
    expect(
      marketplacePolicyWideningProblem(
        { engines: { bb: ">=1.5.0 <2.0.0" } },
        { bbEngineRange: ">=1.0.0 <2.0.0", bbPluginSdkRange: undefined },
      ),
    ).toBeNull();
    expect(
      marketplacePolicyWideningProblem(
        { engines: { bb: ">=1.0.0 <3.0.0" } },
        { bbEngineRange: ">=1.0.0 <2.0.0", bbPluginSdkRange: undefined },
      ),
    ).toMatch(/widens plugin manifest range/);
  });

  it("resolves GitHub Release entries through the managed version resolver", () => {
    const parsed = parseMarketplaceCatalog(
      {
        ...catalog({
          githubRelease: {
            repository: "ymichael/bb",
            package: "bb-plugin-notes",
            range: "^1.2.0",
            tagTemplate: "plugin-notes-v{version}",
            assetTemplate: "bb-plugin-notes-{version}.tgz",
          },
        }),
        plugins: [
          {
            ...catalog({ path: "unused" }).plugins[0],
            source: {
              githubRelease: {
                repository: "ymichael/bb",
                package: "bb-plugin-notes",
                range: "^1.2.0",
                tagTemplate: "plugin-notes-v{version}",
                assetTemplate: "bb-plugin-notes-{version}.tgz",
              },
            },
            installation: {
              engines: { bb: ">=1.0.0", bbPluginSdk: "^0.2.0" },
            },
          },
        ],
      },
      "git",
      root,
    );
    const entry = parsed.plugins[0];
    if (entry === undefined) throw new Error("missing catalog entry");
    expect(catalogEntrySourceDisplay(entry)).toBe(
      "github-release:ymichael/bb/bb-plugin-notes-{version}.tgz@^1.2.0",
    );
    const resolved = resolvedCatalogEntrySource(entry, root);
    expect(resolved.source).toBe("npm:bb-plugin-notes@^1.2.0");
    expect(parseGithubReleaseRegistryUrl(resolved.npmRegistry ?? "")).toEqual({
      repository: "ymichael/bb",
      tagTemplate: "plugin-notes-v{version}",
      assetTemplate: "bb-plugin-notes-{version}.tgz",
      bbEngineRange: ">=1.0.0",
      pluginSdkEngineRange: "^0.2.0",
    });
  });

  it("requires unambiguous version templates for GitHub Release entries", () => {
    expect(() =>
      parseMarketplaceCatalog(
        catalog({
          githubRelease: {
            repository: "ymichael/bb",
            package: "bb-plugin-notes",
            range: "^1.0.0",
            tagTemplate: "plugin-notes-latest",
            assetTemplate: "bb-plugin-notes-{version}.tgz",
          },
        }),
        "git",
        root,
      ),
    ).toThrow(/tagTemplate.*must contain \{version\} exactly once/);
  });
});
