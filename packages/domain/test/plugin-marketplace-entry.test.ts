import { describe, expect, it } from "vitest";
import {
  marketplaceEntryV1Schema,
  marketplaceEntryV2Schema,
} from "../src/plugin-marketplace-entry.js";

function entry(): Record<string, unknown> {
  return {
    id: "author-tools",
    displayName: "Author tools",
    description: "Tools for plugin authors.",
    icon: { url: "./author-tools.svg" },
    tags: ["plugin-development"],
    author: { name: "Author", github: "author" },
    source: {
      git: {
        url: "https://github.com/author/author-tools.git",
        range: "^1.0.0",
        tagPrefix: "author-tools/",
      },
    },
  };
}

describe("marketplace entry schemas", () => {
  it("keeps v1 strict", () => {
    expect(marketplaceEntryV1Schema.parse(entry())).toEqual(entry());
    expect(
      marketplaceEntryV1Schema.safeParse({ ...entry(), category: "utilities" })
        .success,
    ).toBe(false);
  });

  it("accepts optional v2 fields and ignores unknown keys at each level", () => {
    expect(
      marketplaceEntryV2Schema.parse({
        ...entry(),
        category: "acme-tools",
        screenshots: ["./screenshots/one.webp"],
        publishedAt: "2026-08-20T11:47:04-07:00",
        updatedAt: "2026-08-27T16:12:00Z",
        futureEntryField: true,
        icon: { url: "./author-tools.svg", futureIconField: true },
        author: {
          name: "Author",
          github: "author",
          futureAuthorField: true,
        },
        source: {
          git: {
            url: "https://github.com/author/author-tools.git",
            range: "^1.0.0",
            futureGitField: true,
          },
          futureSourceField: true,
        },
      }),
    ).toEqual({
      ...entry(),
      source: {
        git: {
          url: "https://github.com/author/author-tools.git",
          range: "^1.0.0",
        },
      },
      category: "acme-tools",
      screenshots: ["./screenshots/one.webp"],
      publishedAt: "2026-08-20T11:47:04-07:00",
      updatedAt: "2026-08-27T16:12:00Z",
    });
    expect(marketplaceEntryV2Schema.parse(entry())).toEqual(entry());
  });

  it("rejects invalid screenshots and dates", () => {
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        screenshots: ["http://example.com/one.png"],
      }).success,
    ).toBe(false);
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        screenshots: Array.from(
          { length: 7 },
          (_value, index) => `https://example.com/${index}.png`,
        ),
      }).success,
    ).toBe(false);
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        publishedAt: "2026-08-20",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed v2 https URLs", () => {
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        author: { name: "Author", url: "https://" },
      }).success,
    ).toBe(false);
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        source: {
          npm: { package: "author-tools", registry: "https://" },
        },
      }).success,
    ).toBe(false);
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        source: { git: { url: "https://", ref: "v1.0.0" } },
      }).success,
    ).toBe(false);
  });

  it("rejects conflicting known source fields", () => {
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        source: {
          npm: { package: "author-tools" },
          git: {
            url: "https://github.com/author/author-tools.git",
            ref: "v1.0.0",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      marketplaceEntryV2Schema.safeParse({
        ...entry(),
        source: {
          git: {
            url: "https://github.com/author/author-tools.git",
            ref: "v1.0.0",
            range: "^1.0.0",
          },
        },
      }).success,
    ).toBe(false);
  });
});
