import { describe, expect, it } from "vitest";
import {
  installedPluginSchema,
  pluginCatalogInstallRequestSchema,
  pluginCatalogSearchResponseSchema,
  pluginCatalogSearchResultSchema,
  pluginCatalogStatusSchema,
  pluginSettingDescriptorSchema,
} from "../src/index.js";

describe("plugin contracts", () => {
  it("accepts finite number setting descriptors", () => {
    expect(
      pluginSettingDescriptorSchema.parse({
        type: "number",
        label: "Retries",
        default: 3,
      }),
    ).toEqual({ type: "number", label: "Retries", default: 3 });
    expect(
      pluginSettingDescriptorSchema.safeParse({
        type: "number",
        label: "Retries",
        default: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it("keeps an experimental_link on both string and select descriptors", () => {
    const link = { url: "https://example.com/docs", label: "Docs" };
    expect(
      pluginSettingDescriptorSchema.parse({
        type: "string",
        label: "API key",
        experimental_link: link,
      }),
    ).toEqual({ type: "string", label: "API key", experimental_link: link });
    expect(
      pluginSettingDescriptorSchema.parse({
        type: "select",
        label: "Mode",
        options: ["a", "b"],
        experimental_link: { url: "https://example.com/docs" },
      }),
    ).toEqual({
      type: "select",
      label: "Mode",
      options: ["a", "b"],
      experimental_link: { url: "https://example.com/docs" },
    });
  });

  it("rejects a non-URL or unknown key inside experimental_link", () => {
    expect(
      pluginSettingDescriptorSchema.safeParse({
        type: "string",
        label: "API key",
        experimental_link: { url: "not a url" },
      }).success,
    ).toBe(false);
    expect(
      pluginSettingDescriptorSchema.safeParse({
        type: "string",
        label: "API key",
        experimental_link: { url: "https://example.com", target: "_blank" },
      }).success,
    ).toBe(false);
    expect(
      pluginSettingDescriptorSchema.safeParse({
        type: "string",
        label: "API key",
        experimental_link: { url: "https://example.com", label: "" },
      }).success,
    ).toBe(false);
  });

  const issuesForLink = (link: unknown) => {
    const result = pluginSettingDescriptorSchema.safeParse({
      type: "string",
      label: "API key",
      experimental_link: link,
    });
    return result.success ? [] : result.error.issues;
  };

  it("allows only http and https in experimental_link urls", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "//evil.com",
      "https://getbb.app@evil.example/keys",
    ]) {
      expect(issuesForLink({ url }).length, url).toBeGreaterThan(0);
    }
    for (const url of ["http://example.com/a", "https://example.com/a"]) {
      expect(issuesForLink({ url }), url).toEqual([]);
    }
  });

  it("reports why an experimental_link url failed", () => {
    const urlIssues = (url: string) =>
      issuesForLink({ url }).map((issue) => ({
        code: issue.code,
        path: issue.path,
      }));
    expect(urlIssues("javascript:alert(1)")).toContainEqual({
      code: "invalid_format",
      path: ["experimental_link", "url"],
    });
    expect(
      urlIssues(`https://${["user", "pw"].join(":")}@example.com/`),
    ).toEqual([{ code: "custom", path: ["experimental_link", "url"] }]);
    expect(urlIssues(`https://example.com/${"a".repeat(2100)}`)).toEqual([
      { code: "too_big", path: ["experimental_link", "url"] },
    ]);
    expect(
      issuesForLink({ url: "https://example.com", target: "_blank" }).map(
        (issue) => issue.code,
      ),
    ).toEqual(["unrecognized_keys"]);
    expect(issuesForLink({ url: "https://example.com/a" })).toEqual([]);
  });

  it("bounds and de-spoofs the experimental_link label", () => {
    const labelCodes = (label: string) =>
      issuesForLink({ url: "https://example.com", label }).map(
        (issue) => issue.code,
      );
    expect(labelCodes("x".repeat(200_000))).toEqual(["too_big"]);
    expect(labelCodes("Open \u202eelpmas")).toEqual(["invalid_format"]);
    expect(labelCodes("Open dashboard")).toEqual([]);
    expect(labelCodes("Docs \ud83d\udcda")).toEqual([]);
  });

  it("refuses experimental_link on a secret setting", () => {
    const result = pluginSettingDescriptorSchema.safeParse({
      type: "string",
      label: "Key",
      secret: true,
      experimental_link: { url: "https://example.com" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      {
        code: "custom",
        message: "a secret setting cannot be experimental_link",
        path: ["experimental_link"],
      },
    ]);
    expect(
      pluginSettingDescriptorSchema.safeParse({
        type: "string",
        label: "Key",
        experimental_link: { url: "https://example.com" },
      }).success,
    ).toBe(true);
    expect(
      pluginSettingDescriptorSchema.safeParse({
        type: "string",
        label: "Key",
        secret: true,
      }).success,
    ).toBe(true);
  });

  it("accepts catalog install coordinates without marketplace nesting", () => {
    expect(
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
      }),
    ).toEqual({ entryId: "notes" });
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        entryId: "notes",
        version: "1.2.0",
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogInstallRequestSchema.parse({
        marketplace: { marketplaceId: "official", entryId: "notes" },
      }),
    ).toThrow();
  });

  it("keeps status to the bundled plugin count and search fields required", () => {
    const status = {
      pluginCount: 13,
      includedPluginCount: 8,
      optionalPluginCount: 5,
    };
    expect(pluginCatalogStatusSchema.parse(status)).toEqual(status);
    expect(
      pluginCatalogStatusSchema.parse({ ...status, lastError: null }),
    ).toEqual(status);

    expect(() =>
      pluginCatalogSearchResultSchema.parse({
        entryId: "notes",
        displayName: "Notes",
        description: "Notes",
        icon: null,
        category: "Productivity",
        source: "builtin:notes",
        installed: false,
        compatible: true,
        incompatibleReason: null,
      }),
    ).toThrow();
  });

  it("parses v2 discovery metadata and defaults search arrays", () => {
    const required = {
      entryId: "notes",
      pluginId: "notes",
      displayName: "Notes",
      description: "Notes",
      icon: null,
      iconUrl: null,
      source: "git:https://github.com/acme/notes.git@v1",
      marketplace: "acme",
      marketplaceDisplayName: "Acme",
      publisherKey: "acme",
      publisherLabel: "Acme",
      official: false,
      author: null,
      installed: false,
      conflictingInstallSource: null,
      compatible: true,
      incompatibleReason: null,
    };
    expect(pluginCatalogSearchResultSchema.parse(required)).toMatchObject({
      screenshots: [],
      collections: [],
    });
    expect(
      pluginCatalogSearchResultSchema.parse({
        ...required,
        categoryId: "acme-tools",
        category: "Acme tools",
        screenshots: ["https://cdn.example.com/notes.png"],
        collections: [{ id: "featured", rank: 0 }],
        publishedAt: "2026-08-20T11:47:04-07:00",
        updatedAt: "2026-08-27T16:12:00Z",
      }),
    ).toMatchObject({
      categoryId: "acme-tools",
      category: "Acme tools",
      collections: [{ id: "featured", rank: 0 }],
    });
    expect(
      pluginCatalogSearchResultSchema.safeParse({
        ...required,
        categoryId: "Acme tools",
      }).success,
    ).toBe(false);
  });

  it("requires complete collections on the catalog search response", () => {
    expect(
      pluginCatalogSearchResponseSchema.parse({
        results: [],
        collections: [
          {
            id: "featured",
            displayName: "Featured",
            pluginIds: ["notes", "tasks"],
          },
        ],
      }),
    ).toEqual({
      results: [],
      collections: [
        {
          id: "featured",
          displayName: "Featured",
          pluginIds: ["notes", "tasks"],
        },
      ],
      categories: [],
    });
    expect(
      pluginCatalogSearchResponseSchema.safeParse({ results: [] }).success,
    ).toBe(false);
  });

  it("requires server-filled installed plugin discovery arrays", () => {
    expect(
      installedPluginSchema.shape.screenshots.safeParse(undefined).success,
    ).toBe(false);
    expect(
      installedPluginSchema.shape.collections.safeParse(undefined).success,
    ).toBe(false);
  });
});
