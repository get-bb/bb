import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseMarketplaceManifest } from "../../../src/services/plugin-catalog/marketplace-manifest.js";

/**
 * The published contract and the runtime parser are two hand-written
 * documents. A manifest the registry's CI accepts and BB then rejects breaks
 * the whole catalog, so both must answer the same way for every fixture here.
 * Add a fixture with each rule either side gains.
 */
const SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../../web/public/schemas/marketplace.schema.json",
    import.meta.url,
  ),
);

/** The published document is a file on disk: parse it before Ajv sees it. */
const publishedSchemaSchema = z.record(z.string(), z.unknown());

async function compilePublishedSchema(): Promise<(value: unknown) => boolean> {
  const schema = publishedSchemaSchema.parse(
    JSON.parse(await readFile(SCHEMA_PATH, "utf8")),
  );
  return new Ajv2020({ strict: false }).compile(schema);
}

interface Fixture {
  readonly label: string;
  readonly valid: boolean;
  readonly manifest: unknown;
}

function manifestWith(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "acme",
    displayName: "Acme plugins",
    plugins: [
      {
        id: "acme-plugin",
        displayName: "Acme",
        description: "An Acme plugin.",
        icon: "ZoomIn",
        author: { name: "Acme" },
        source: { npm: { package: "bb-plugin-acme" } },
        ...entry,
      },
    ],
  };
}

function iconFixture(label: string, url: string, valid: boolean): Fixture {
  return { label, valid, manifest: manifestWith({ icon: { url } }) };
}

function rangeFixture(label: string, range: string, valid: boolean): Fixture {
  return {
    label,
    valid,
    manifest: manifestWith({
      source: { npm: { package: "bb-plugin-acme", range } },
    }),
  };
}

/**
 * A listing declares no compatibility ranges. Both documents must reject the
 * old `engines` key alike, so a stale manifest fails in the registry's CI
 * rather than only inside bb.
 */
function enginesFixture(label: string, engines: unknown): Fixture {
  return { label, valid: false, manifest: manifestWith({ engines }) };
}

const fixtures: readonly Fixture[] = [
  { label: "minimal npm entry", valid: true, manifest: manifestWith({}) },
  {
    label: "git entry",
    valid: true,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          ref: "v1.2.3",
          subdir: "plugins/acme",
        },
      },
    }),
  },
  {
    label: "git semver range entry",
    valid: true,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          range: "^1.2.3",
          tagPrefix: "acme/",
          subdir: "plugins/acme",
        },
      },
    }),
  },
  {
    label: "invalid git semver range",
    valid: false,
    manifest: manifestWith({
      source: {
        git: {
          url: "https://example.com/acme/plugin.git",
          range: "latest",
        },
      },
    }),
  },
  {
    label: "unknown entry field",
    valid: false,
    manifest: manifestWith({ surprise: true }),
  },
  {
    label: "npm range and tag together",
    valid: false,
    manifest: manifestWith({
      source: {
        npm: { package: "bb-plugin-acme", range: "^1.0.0", tag: "beta" },
      },
    }),
  },

  iconFixture("absolute https icon", "https://cdn.example.com/a.svg", true),
  iconFixture("relative icon", "icons/acme.png", true),
  iconFixture("dot-relative icon", "./acme.webp", true),
  iconFixture("uppercase extension", "https://cdn.example.com/A.PNG", true),
  iconFixture(
    "query after the extension",
    "https://cdn.example.com/a.svg?v=2",
    true,
  ),
  iconFixture("ftp icon", "ftp://host.example.com/icon.svg", false),
  iconFixture("plain http icon", "http://cdn.example.com/a.svg", false),
  iconFixture("data URL icon", "data:image/svg+xml,a.svg", false),
  iconFixture("javascript URL icon", "javascript:a.svg", false),
  iconFixture("unsupported extension", "https://cdn.example.com/a.gif", false),
  iconFixture("no extension", "https://cdn.example.com/a", false),
  {
    label: "unknown icon field",
    valid: false,
    manifest: manifestWith({ icon: { url: "./acme.svg", logo: true } }),
  },

  rangeFixture("caret range", "^1.2.3", true),
  rangeFixture("comparator pair", ">=1.0.0 <2.0.0", true),
  rangeFixture("hyphen range", "1.2.3 - 2.3.4", true),
  rangeFixture("alternatives", "1.x || >=2.5.0", true),
  rangeFixture("prerelease comparator", ">1.2.3-alpha.3", true),
  rangeFixture("star", "*", true),
  rangeFixture("prose", "latest", false),
  rangeFixture("bare operator", ">=", false),
  rangeFixture("four segments", "1.2.3.4", false),
  rangeFixture("garbage alternative", "1.0.0 || garbage", false),

  enginesFixture("engines.bb range", { bb: ">=0.30.0" }),
  enginesFixture("engines.bbPluginSdk range", { bbPluginSdk: "^0.5.0" }),
  enginesFixture("empty engines object", {}),

  {
    label: "marketplace name at the route limit",
    valid: true,
    manifest: { ...manifestWith({}), name: "a".repeat(64) },
  },
  {
    label: "marketplace name past the route limit",
    valid: false,
    manifest: { ...manifestWith({}), name: "a".repeat(65) },
  },
];

describe("published marketplace schema parity", () => {
  it("agrees with the runtime parser on every fixture", async () => {
    const validate = await compilePublishedSchema();

    const disagreements = fixtures.flatMap((fixture) => {
      const published = validate(fixture.manifest);
      let runtime = true;
      try {
        parseMarketplaceManifest(fixture.manifest, "fixture");
      } catch {
        runtime = false;
      }
      return published === fixture.valid && runtime === fixture.valid
        ? []
        : [
            `${fixture.label}: expected ${fixture.valid ? "valid" : "invalid"}, published schema said ${published}, runtime parser said ${runtime}`,
          ];
    });

    expect(disagreements).toEqual([]);
  });

  it("caps the entry count in both contracts", async () => {
    const validate = await compilePublishedSchema();
    const oversize = {
      schemaVersion: 1,
      name: "acme",
      displayName: "Acme plugins",
      plugins: Array.from({ length: 257 }, (_unused, index) => ({
        id: `acme-plugin-${index}`,
        displayName: "Acme",
        description: "An Acme plugin.",
        icon: "ZoomIn",
        author: { name: "Acme" },
        source: { npm: { package: `bb-plugin-acme-${index}` } },
      })),
    };

    expect(validate(oversize)).toBe(false);
    expect(() => parseMarketplaceManifest(oversize, "fixture")).toThrow(
      /at most 256 plugins/u,
    );
  });
});
