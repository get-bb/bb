import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COLLECTION_SCHEMA_URL,
  parsePluginCollectionManifest,
  readPluginCollectionManifest,
  resolveSelectedSubdirectory,
  subdirectoryForCollectionEntry,
} from "../../../src/services/plugins/collection-manifest.js";

function manifest(plugins: unknown): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "acme-plugins",
    plugins,
  });
}

function parse(plugins: unknown) {
  return parsePluginCollectionManifest(manifest(plugins), ".bb/plugins.json");
}

describe("collection manifest schema", () => {
  it("accepts an index of nested plugin directories", () => {
    const parsed = parsePluginCollectionManifest(
      JSON.stringify({
        $schema: COLLECTION_SCHEMA_URL,
        schemaVersion: 1,
        name: "acme-plugins",
        plugins: [
          { name: "sidebar", source: "./plugins/sidebar" },
          { name: "status", source: "./apps/status" },
        ],
      }),
      ".bb/plugins.json",
    );

    expect(parsed.plugins).toHaveLength(2);
    expect(subdirectoryForCollectionEntry(parsed, "status")).toBe(
      "apps/status",
    );
  });

  it("rejects sources that escape or select the repository root", () => {
    for (const source of [
      "./../evil",
      "./plugins/../../evil",
      "/etc/passwd",
      "plugins/sidebar",
      ".",
      "./",
      "./plugins//sidebar",
      "./plugins/sidebar/",
      "./plugins/./sidebar",
      "./.git",
      "./plugins/.git/hooks",
      "./plugins\\sidebar",
    ]) {
      expect(() => parse([{ name: "sidebar", source }])).toThrowError(
        /invalid \.bb\/plugins\.json/,
      );
    }
  });

  it("rejects duplicate entry names, unknown fields, and other schema versions", () => {
    expect(() =>
      parse([
        { name: "sidebar", source: "./a" },
        { name: "sidebar", source: "./b" },
      ]),
    ).toThrowError(/duplicate plugin name "sidebar"/);
    expect(() =>
      parse([{ name: "sidebar", source: "./a", subdir: "./b" }]),
    ).toThrowError(/invalid \.bb\/plugins\.json/);
    expect(() =>
      parse([{ name: "sidebar", source: "./a", description: "Sidebar" }]),
    ).toThrowError(/invalid \.bb\/plugins\.json/);
    expect(() => parse([{ name: "Sidebar", source: "./a" }])).toThrowError(
      /invalid \.bb\/plugins\.json/,
    );
    expect(() =>
      parsePluginCollectionManifest(
        JSON.stringify({
          schemaVersion: 2,
          name: "acme-plugins",
          plugins: [{ name: "a", source: "./a" }],
        }),
        ".bb/plugins.json",
      ),
    ).toThrowError(/invalid \.bb\/plugins\.json/);
    expect(() =>
      parsePluginCollectionManifest("{ nope", ".bb/plugins.json"),
    ).toThrowError(/not valid JSON/);
    expect(() =>
      parsePluginCollectionManifest(
        JSON.stringify({
          $schema: "https://example.test/plugins.schema.json",
          schemaVersion: 1,
          name: "acme-plugins",
          plugins: [{ name: "a", source: "./a" }],
        }),
        ".bb/plugins.json",
      ),
    ).toThrowError(/invalid \.bb\/plugins\.json/);
  });

  it("names the available entries when a name is unknown", () => {
    const parsed = parse([
      { name: "sidebar", source: "./a" },
      { name: "status", source: "./b" },
    ]);
    expect(() =>
      subdirectoryForCollectionEntry(parsed, "missing"),
    ).toThrowError(/no plugin "missing" — available: sidebar, status/);
  });
});

describe("collection manifest in a checkout", () => {
  let workDir: string;
  let repoDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-collection-"));
    repoDir = join(workDir, "repo");
    await mkdir(join(repoDir, ".bb"), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeCollection(plugins: unknown): Promise<void> {
    await writeFile(join(repoDir, ".bb", "plugins.json"), manifest(plugins));
  }

  async function writeRootPackage(): Promise<void> {
    await writeFile(
      join(repoDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-root",
        version: "0.1.0",
        bb: {
          name: "Root",
          description: "Root plugin.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(repoDir, "server.ts"), "export default () => {};");
  }

  it("returns null when the repository has no collection manifest", async () => {
    await rm(join(repoDir, ".bb"), { recursive: true });
    expect(await readPluginCollectionManifest(repoDir)).toBeNull();
  });

  it("refuses a manifest symlinked out of the checkout", async () => {
    const outside = join(workDir, "outside.json");
    await writeFile(outside, manifest([{ name: "a", source: "./a" }]));
    await symlink(outside, join(repoDir, ".bb", "plugins.json"));

    await expect(readPluginCollectionManifest(repoDir)).rejects.toThrowError(
      /resolves outside its root/,
    );
  });

  it("lists the entries when a collection repository has no root plugin", async () => {
    await writeCollection([
      { name: "sidebar", source: "./plugins/sidebar" },
      { name: "status", source: "./plugins/status" },
    ]);

    await expect(
      resolveSelectedSubdirectory({
        checkoutDir: repoDir,
        selection: { kind: "root" },
        sourceLabel: "repo",
      }),
    ).rejects.toThrowError(/--plugin <name> \(sidebar, status\)/);
  });

  it("keeps the root install when the repository is itself a plugin", async () => {
    await writeCollection([{ name: "sidebar", source: "./plugins/sidebar" }]);
    await writeRootPackage();

    expect(
      await resolveSelectedSubdirectory({
        checkoutDir: repoDir,
        selection: { kind: "root" },
        sourceLabel: "repo",
      }),
    ).toBeNull();
  });

  it("resolves an entry name and rejects an entry without a manifest", async () => {
    await writeCollection([{ name: "sidebar", source: "./plugins/sidebar" }]);
    expect(
      await resolveSelectedSubdirectory({
        checkoutDir: repoDir,
        selection: { kind: "entry", name: "sidebar" },
        sourceLabel: "repo",
      }),
    ).toBe("plugins/sidebar");

    await rm(join(repoDir, ".bb"), { recursive: true });
    await expect(
      resolveSelectedSubdirectory({
        checkoutDir: repoDir,
        selection: { kind: "entry", name: "sidebar" },
        sourceLabel: "repo",
      }),
    ).rejects.toThrowError(/no \.bb\/plugins\.json collection manifest/);
  });

  it("rejects a --subdirectory that escapes the checkout", async () => {
    for (const path of [
      "../evil",
      "/etc",
      "plugins/../../evil",
      ".",
      ".git",
      "plugins/.git/hooks",
      "plugins\\sidebar",
    ]) {
      await expect(
        resolveSelectedSubdirectory({
          checkoutDir: repoDir,
          selection: { kind: "subdirectory", path },
          sourceLabel: "repo",
        }),
      ).rejects.toThrowError(/invalid plugin subdirectory/);
    }
  });
});
