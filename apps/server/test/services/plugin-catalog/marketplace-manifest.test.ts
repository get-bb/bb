import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  entryRepositoryUrl,
  entrySourceDisplay,
  parseMarketplaceManifest,
  resolveEntryIcon,
  resolvedEntrySource,
  type MarketplaceEntry,
} from "../../../src/services/plugin-catalog/marketplace-manifest.js";
import { BUNDLED_CURATED_MARKETPLACE } from "../../../src/services/plugin-catalog/curated-marketplace.js";

const MANIFEST_URL = "https://getbb.app/marketplace/v1/marketplace.json";

const publishedSchemaShape = z.object({
  $defs: z.object({
    gitRangeSource: z.object({
      properties: z.object({
        git: z.object({
          properties: z.object({
            tagPrefix: z.object({ pattern: z.string() }),
          }),
        }),
      }),
    }),
  }),
});

const publishedTagPrefixPattern = new RegExp(
  publishedSchemaShape.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../web/public/schemas/marketplace.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  ).$defs.gitRangeSource.properties.git.properties.tagPrefix.pattern,
  "u",
);

function entry(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "widgets",
    displayName: "Acme Widgets",
    description: "Widgets for threads.",
    icon: "Zap",
    author: { name: "Acme" },
    source: {
      git: { url: "https://github.com/acme/plugins.git", ref: "v1.0.0" },
    },
    ...overrides,
  };
}

function manifest(plugins: unknown[]): unknown {
  return {
    schemaVersion: 1,
    name: "bb-community",
    displayName: "BB Community",
    plugins,
  };
}

function parse(plugins: unknown[]) {
  return parseMarketplaceManifest(manifest(plugins), "manifest");
}

function firstEntry(plugins: unknown[]): MarketplaceEntry {
  const parsed = parse(plugins).plugins[0];
  if (parsed === undefined) throw new Error("entry missing");
  return parsed;
}

describe("marketplace manifest schema", () => {
  it("accepts a fully populated entry", () => {
    const parsed = parse([
      entry({
        icon: { url: "./icons/widgets.svg" },
        tags: ["interface", "threads"],
        author: {
          name: "Acme",
          github: "acme-co",
          url: "https://acme.example",
        },
      }),
    ]);
    expect(parsed.plugins).toHaveLength(1);
  });

  it("rejects a schemaVersion it does not implement", () => {
    expect(() =>
      parseMarketplaceManifest(
        { ...(manifest([entry()]) as object), schemaVersion: 2 },
        "manifest",
      ),
    ).toThrow(/unknown schemaVersion 2/);
  });

  it("rejects unknown fields anywhere in the document", () => {
    expect(() => parse([entry({ category: "Interface" })])).toThrow(
      /unrecognized key/iu,
    );
    expect(() =>
      parseMarketplaceManifest(
        { ...(manifest([entry()]) as object), extra: true },
        "manifest",
      ),
    ).toThrow(/unrecognized key/iu);
  });

  it("rejects duplicate entry ids", () => {
    expect(() => parse([entry(), entry()])).toThrow(
      /duplicate plugin id "widgets"/,
    );
  });

  it("rejects ids that are not lowercase kebab", () => {
    expect(() => parse([entry({ id: "Widgets" })])).toThrow();
    expect(() => parse([entry({ id: "-widgets" })])).toThrow();
  });

  describe("icons", () => {
    it("accepts a host icon name, https URL, or relative URL", () => {
      expect(() => parse([entry({ icon: "ZoomIn" })])).not.toThrow();
      expect(() =>
        parse([entry({ icon: { url: "https://cdn.example/icon.png" } })]),
      ).not.toThrow();
      expect(() =>
        parse([entry({ icon: { url: "./icons/widgets.webp" } })]),
      ).not.toThrow();
    });

    it("rejects http URLs and unsupported formats", () => {
      expect(() =>
        parse([entry({ icon: { url: "http://cdn.example/icon.png" } })]),
      ).toThrow(/https/);
      expect(() =>
        parse([entry({ icon: { url: "https://cdn.example/icon.gif" } })]),
      ).toThrow(/\.svg/);
      expect(() => parse([entry({ icon: "./icons/widgets.svg" })])).toThrow();
    });

    it("resolves a relative URL against the manifest URL", () => {
      expect(
        resolveEntryIcon(
          firstEntry([entry({ icon: { url: "./icons/widgets.svg" } })]),
          { kind: "url", manifestUrl: MANIFEST_URL },
        ),
      ).toEqual({
        kind: "remote",
        url: "https://getbb.app/marketplace/v1/icons/widgets.svg",
      });
      expect(
        resolveEntryIcon(firstEntry([entry()]), {
          kind: "url",
          manifestUrl: MANIFEST_URL,
        }),
      ).toBe(null);
    });

    it("reads a relative URL beside the manifest for a local marketplace", () => {
      expect(
        resolveEntryIcon(
          firstEntry([entry({ icon: { url: "./icons/widgets.svg" } })]),
          { kind: "dir", root: "/checkout" },
        ),
      ).toEqual({
        kind: "local",
        path: "/checkout/icons/widgets.svg",
        relativePath: "icons/widgets.svg",
      });
      // An absolute icon URL stays remote even for a local marketplace.
      expect(
        resolveEntryIcon(
          firstEntry([
            entry({ icon: { url: "https://cdn.example/widgets.svg" } }),
          ]),
          { kind: "dir", root: "/checkout" },
        ),
      ).toEqual({ kind: "remote", url: "https://cdn.example/widgets.svg" });
    });
  });

  describe("tags", () => {
    it("rejects more than ten tags, long tags, and non-kebab tags", () => {
      expect(() =>
        parse([entry({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })]),
      ).toThrow();
      expect(() => parse([entry({ tags: ["a".repeat(33)] })])).toThrow();
      expect(() => parse([entry({ tags: ["Interface"] })])).toThrow();
      expect(() => parse([entry({ tags: ["two--dashes"] })])).toThrow();
    });
  });

  describe("author", () => {
    it("requires a name and validates github and url", () => {
      expect(() => parse([entry({ author: {} })])).toThrow();
      expect(() =>
        parse([entry({ author: { name: "Acme", github: "not a login" } })]),
      ).toThrow();
      expect(() =>
        parse([
          entry({ author: { name: "Acme", url: "http://acme.example" } }),
        ]),
      ).toThrow(/https/);
      expect(() =>
        parse([entry({ author: { name: "Acme", email: "a@b.test" } })]),
      ).toThrow(/unrecognized key/iu);
    });
  });

  describe("sources", () => {
    it("rejects npm package names the install pipeline cannot parse", () => {
      for (const packageName of ["../plugin", "name@version", "--registry"]) {
        expect(() =>
          parse([
            entry({
              source: { npm: { package: packageName, range: "^1.0.0" } },
            }),
          ]),
        ).toThrow(/npm package|ambiguous/);
      }
    });

    it("rejects an npm entry that sets both range and tag", () => {
      expect(() =>
        parse([
          entry({
            source: {
              npm: {
                package: "bb-plugin-widgets",
                range: "^1.0.0",
                tag: "beta",
              },
            },
          }),
        ]),
      ).toThrow(/mutually exclusive/);
    });

    it("rejects a git subdir that escapes the repository", () => {
      for (const subdir of ["../evil", "/abs/path", "plugins/../../evil"]) {
        expect(() =>
          parse([
            entry({
              source: {
                git: {
                  url: "https://github.com/acme/plugins.git",
                  ref: "v1",
                  subdir,
                },
              },
            }),
          ]),
        ).toThrow();
      }
    });

    it("rejects git refs that change meaning in an install source", () => {
      for (const ref of ["release@other", "-upload-pack", "release..next"]) {
        expect(() =>
          parse([
            entry({
              source: {
                git: {
                  url: "https://github.com/acme/plugins.git",
                  ref,
                },
              },
            }),
          ]),
        ).toThrow(/git ref/);
      }
    });

    it("accepts a git range entry and rejects one that also names a ref", () => {
      const ranged = firstEntry([
        entry({
          source: {
            git: {
              url: "https://github.com/acme/plugins.git",
              range: "^1.0.0",
              tagPrefix: "widgets/",
              subdir: "plugins/widgets",
            },
          },
        }),
      ]);
      expect(resolvedEntrySource(ranged)).toEqual({
        source:
          "git:https://github.com/acme/plugins.git@semver:widgets/:^1.0.0",
        selection: { kind: "subdirectory", path: "plugins/widgets" },
      });
      expect(entrySourceDisplay(ranged)).toBe(
        "git:https://github.com/acme/plugins.git@^1.0.0#plugins/widgets (tags widgets/vX.Y.Z)",
      );

      // ref and range are mutually exclusive, and a range entry still needs
      // one of them.
      for (const git of [
        {
          url: "https://github.com/acme/plugins.git",
          ref: "v1.0.0",
          range: "^1.0.0",
        },
        { url: "https://github.com/acme/plugins.git" },
        { url: "https://github.com/acme/plugins.git", range: "not a range" },
        {
          url: "https://github.com/acme/plugins.git",
          range: "^1.0.0",
          tagPrefix: "../evil/",
        },
        {
          url: "https://github.com/acme/plugins.git",
          range: "^1.0.0",
          tagPrefix: "widgets/.hidden/",
        },
        {
          url: "https://github.com/acme/plugins.git",
          range: "^1.0.0",
          tagPrefix: "widgets.lock/",
        },
        {
          url: "https://github.com/acme/plugins.git",
          ref: "v1.0.0",
          tagPrefix: "widgets/",
        },
      ]) {
        expect(() => parse([entry({ source: { git } })])).toThrow();
      }
      expect(publishedTagPrefixPattern.test("widgets/.hidden/")).toBe(false);
      expect(publishedTagPrefixPattern.test("widgets.lock/")).toBe(false);
      expect(publishedTagPrefixPattern.test("widgets./")).toBe(true);
    });

    it("translates entries into install-pipeline inputs", () => {
      const git = firstEntry([
        entry({
          source: {
            git: {
              url: "https://github.com/acme/plugins.git",
              ref: "v1.0.0",
              subdir: "plugins/widgets",
            },
          },
        }),
      ]);
      expect(resolvedEntrySource(git)).toEqual({
        source: "git:https://github.com/acme/plugins.git@v1.0.0",
        selection: { kind: "subdirectory", path: "plugins/widgets" },
      });
      expect(entrySourceDisplay(git)).toBe(
        "git:https://github.com/acme/plugins.git@v1.0.0#plugins/widgets",
      );

      const npm = firstEntry([
        entry({
          source: {
            npm: {
              package: "bb-plugin-widgets",
              range: "^1.0.0",
              registry: "https://npm.acme.test",
            },
          },
        }),
      ]);
      expect(resolvedEntrySource(npm)).toEqual({
        source: "npm:bb-plugin-widgets@^1.0.0",
        selection: { kind: "root" },
        npmRegistry: "https://npm.acme.test",
      });
    });
  });

  describe("repository url", () => {
    it("links a git repository without its .git suffix", () => {
      expect(entryRepositoryUrl(firstEntry([entry()]))).toBe(
        "https://github.com/acme/plugins",
      );
    });

    it("links a GitHub subdirectory to its tree, other hosts to the root", () => {
      const github = firstEntry([
        entry({
          source: {
            git: {
              url: "https://github.com/acme/plugins.git",
              ref: "v1.0.0",
              subdir: "plugins/widgets",
            },
          },
        }),
      ]);
      expect(entryRepositoryUrl(github)).toBe(
        "https://github.com/acme/plugins/tree/HEAD/plugins/widgets",
      );
      const gitlab = firstEntry([
        entry({
          source: {
            git: {
              url: "https://gitlab.com/acme/plugins",
              ref: "v1.0.0",
              subdir: "plugins/widgets",
            },
          },
        }),
      ]);
      expect(entryRepositoryUrl(gitlab)).toBe(
        "https://gitlab.com/acme/plugins",
      );
      // `#` and `?` pass the subdirectory check; raw they would change the
      // URL's meaning.
      const reserved = firstEntry([
        entry({
          source: {
            git: {
              url: "https://github.com/acme/plugins",
              ref: "v1.0.0",
              subdir: "plugins/c#/what?",
            },
          },
        }),
      ]);
      expect(entryRepositoryUrl(reserved)).toBe(
        "https://github.com/acme/plugins/tree/HEAD/plugins/c%23/what%3F",
      );
    });

    it("links the public npm page only for the default registry", () => {
      const publicPackage = firstEntry([
        entry({
          source: { npm: { package: "@acme/widgets", range: "^1.0.0" } },
        }),
      ]);
      expect(entryRepositoryUrl(publicPackage)).toBe(
        "https://www.npmjs.com/package/@acme/widgets",
      );
      const privatePackage = firstEntry([
        entry({
          source: {
            npm: {
              package: "bb-plugin-widgets",
              range: "^1.0.0",
              registry: "https://npm.acme.test",
            },
          },
        }),
      ]);
      expect(entryRepositoryUrl(privatePackage)).toBeNull();
    });
  });

  describe("engines policy", () => {
    // A listing no longer declares compatibility: the ranges live in the
    // plugin's own package.json and the install pipeline enforces them there.
    // The entry schema is strict, so a stale listing fails loudly rather than
    // carrying a range bb would silently ignore.
    it("refuses an entry that declares engine ranges", () => {
      for (const engines of [
        { bb: ">=1.0.0" },
        { bbPluginSdk: "^0.5.0" },
        { bb: ">=1.0.0", bbPluginSdk: "^0.5.0" },
      ]) {
        expect(() => parse([entry({ engines })])).toThrow(/engines/u);
      }
    });
  });

  it("validates the bundled seed snapshot", () => {
    expect(() =>
      parseMarketplaceManifest(BUNDLED_CURATED_MARKETPLACE, "bundled snapshot"),
    ).not.toThrow();
  });
});
