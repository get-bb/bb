import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PLUGIN_CATALOG_CATEGORIES } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateBbOfficialMarketplace,
  parseBbOfficialCatalogFields,
  readPluginGitDates,
} from "../../../scripts/generate-bb-official-marketplace.js";
import {
  BUNDLED_MARKETPLACE_NAME,
  isBundledMarketplaceEntry,
  parseBundledMarketplaceManifestJson,
} from "../../../src/services/plugin-catalog/marketplace-manifest.js";
import { loadBundledMarketplace } from "../../../src/services/plugin-catalog/bundled-marketplace.js";
import { BUNDLED_PLUGINS } from "../../../src/services/plugins/builtin-registry.js";

const run = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("bb-official marketplace generator", () => {
  it("generates one valid v2 entry for every bundled plugin", async () => {
    const raw = await readFile(
      new URL(
        "../../../src/generated/bb-official-marketplace/marketplace.json",
        import.meta.url,
      ),
      "utf8",
    );
    const catalog = parseBundledMarketplaceManifestJson(
      raw,
      "generated marketplace",
    );
    const fields = parseBbOfficialCatalogFields(
      JSON.parse(
        await readFile(
          new URL("../../../../../plugins/bb-official.json", import.meta.url),
          "utf8",
        ),
      ),
      BUNDLED_PLUGINS,
    );

    expect(catalog.name).toBe(BUNDLED_MARKETPLACE_NAME);
    expect(catalog.displayName).toBe("BB Official");
    expect(catalog.categories).toEqual(PLUGIN_CATALOG_CATEGORIES);
    expect(catalog.plugins).toHaveLength(BUNDLED_PLUGINS.length);
    expect(catalog.collections).toEqual([
      {
        id: "bb-official",
        displayName: "BB Official",
        pluginIds: BUNDLED_PLUGINS.map((plugin) => plugin.pluginId),
      },
    ]);
    for (const plugin of BUNDLED_PLUGINS) {
      const entry = catalog.plugins.find(
        (candidate) =>
          isBundledMarketplaceEntry(candidate) &&
          candidate.source.bundled.plugin === plugin.name,
      );
      expect(entry?.id).toBe(plugin.pluginId);
      expect(entry?.screenshots).toEqual(fields[plugin.name]?.screenshots);
      expect(entry?.author).toEqual({ name: "BB" });
    }
  });

  it("rejects missing and unknown catalog blocks", () => {
    const plugins = [
      { name: "alpha", pluginId: "alpha" },
      { name: "beta", pluginId: "beta" },
    ];
    const block = { category: "utilities", screenshots: [] };

    expect(() =>
      parseBbOfficialCatalogFields({ alpha: block }, plugins),
    ).toThrow(/missing bundled plugin blocks: beta/u);
    expect(() =>
      parseBbOfficialCatalogFields(
        { alpha: block, beta: block, gamma: block },
        plugins,
      ),
    ).toThrow(/unknown bundled plugin blocks: gamma/u);
  });

  it("names the generator task when the generated document is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bb-official-missing-"));
    cleanup.push(root);

    expect(() => loadBundledMarketplace([], root)).toThrow(
      "pnpm exec turbo run generate:bb-official-marketplace --filter=@bb/server",
    );
  });

  it("uses the first and last committer dates from plugin history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bb-official-history-"));
    cleanup.push(root);
    const pluginDirectory = path.join(root, "plugins", "sample");
    await mkdir(pluginDirectory, { recursive: true });
    await run("git", ["init", "-q", "-b", "main"], { cwd: root });
    await run("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    await run("git", ["config", "user.name", "Test"], { cwd: root });
    await writeFile(path.join(pluginDirectory, "file.txt"), "one");
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-qm", "first"], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z",
        GIT_COMMITTER_DATE: "2026-01-02T03:04:05Z",
      },
    });
    await writeFile(path.join(pluginDirectory, "file.txt"), "two");
    await run("git", ["commit", "-qam", "last"], {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-02-03T04:05:06Z",
        GIT_COMMITTER_DATE: "2026-02-03T04:05:06Z",
      },
    });

    const dates = await readPluginGitDates({
      repositoryRoot: root,
      plugins: [{ name: "sample", pluginId: "sample" }],
      warn: (message) => {
        throw new Error(message);
      },
    });

    expect(dates.get("sample")).toEqual({
      publishedAt: "2026-01-02T03:04:05Z",
      updatedAt: "2026-02-03T04:05:06Z",
    });
  });

  it("omits dates and prints one warning in a shallow repository", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bb-official-generator-"));
    cleanup.push(root);
    const origin = path.join(root, "origin");
    const checkout = path.join(root, "checkout");
    await mkdir(path.join(origin, "plugins", "sample"), { recursive: true });
    await writeFile(
      path.join(origin, "plugins", "sample", "package.json"),
      JSON.stringify({
        name: "bb-plugin-sample",
        version: "1.0.0",
        bb: {
          name: "Sample",
          description: "A sample plugin.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      path.join(origin, "plugins", "bb-official.json"),
      JSON.stringify({
        sample: { category: "utilities", screenshots: [] },
      }),
    );
    await run("git", ["init", "-q", "-b", "main"], { cwd: origin });
    await run("git", ["config", "user.email", "test@example.com"], {
      cwd: origin,
    });
    await run("git", ["config", "user.name", "Test"], { cwd: origin });
    await run("git", ["add", "."], { cwd: origin });
    await run("git", ["commit", "-qm", "initial"], { cwd: origin });
    await writeFile(
      path.join(origin, "plugins", "sample", "server.ts"),
      "export {};\n",
    );
    await run("git", ["add", "."], { cwd: origin });
    await run("git", ["commit", "-qm", "update"], { cwd: origin });
    await run(
      "git",
      ["clone", "-q", "--depth=1", pathToFileURL(origin).href, checkout],
      { cwd: root },
    );
    const warnings: string[] = [];
    const outputPath = path.join(checkout, "marketplace.json");

    await generateBbOfficialMarketplace({
      repositoryRoot: checkout,
      catalogFieldsPath: path.join(checkout, "plugins", "bb-official.json"),
      outputPath,
      plugins: [{ name: "sample", pluginId: "sample" }],
      warn: (message) => warnings.push(message),
    });

    const catalog = parseBundledMarketplaceManifestJson(
      await readFile(outputPath, "utf8"),
      "shallow marketplace",
    );
    expect(catalog.plugins[0]).not.toHaveProperty("publishedAt");
    expect(catalog.plugins[0]).not.toHaveProperty("updatedAt");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/complete Git history is unavailable/u);
  });
});
