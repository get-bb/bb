import { describe, expect, it } from "vitest";
import {
  installedPluginSchema,
  pluginCatalogInstallRequestSchema,
  pluginCatalogSearchResponseSchema,
  pluginCatalogSearchResultSchema,
  pluginCatalogStatusSchema,
  pluginRollbackRequestSchema,
  pluginSettingDescriptorSchema,
  pluginUpdateJobListResponseSchema,
  pluginUpdateJobSchema,
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

  it("reads a job from a server that predates rollback as an update", () => {
    const job = {
      id: "job-1",
      pluginId: "notes",
      displayName: "Notes",
      state: "running",
      phase: "checking",
    };
    expect(
      pluginUpdateJobListResponseSchema
        .parse({
          jobs: [job, { ...job, id: "job-2", kind: "rollback" }],
        })
        .jobs.map((entry) => entry.kind),
    ).toEqual(["update", "rollback"]);
  });

  it("reads a completed job's result by the job's kind", () => {
    const completed = {
      id: "job-1",
      pluginId: "notes",
      displayName: "Notes",
      state: "completed",
    };
    const from = { version: "1.1.0", label: "1.1.0", display: "1.1.0" };
    const to = { version: "1.0.0", label: "1.0.0", display: "1.0.0" };
    expect(
      pluginUpdateJobSchema.parse({
        ...completed,
        result: { applied: true, from, to, outcome: "updated" },
      }),
    ).toMatchObject({ kind: "update" });
    expect(
      pluginUpdateJobSchema.parse({
        ...completed,
        kind: "rollback",
        result: { applied: true, from, to, outcome: "reverted" },
      }),
    ).toMatchObject({ kind: "rollback" });
    for (const job of [
      {
        ...completed,
        result: { applied: true, from, to, outcome: "reverted" },
      },
      {
        ...completed,
        kind: "rollback",
        result: { applied: true, from, to, outcome: "updated" },
      },
      {
        ...completed,
        kind: "rollback",
        result: { applied: true, from, outcome: "reverted" },
      },
    ]) {
      expect(pluginUpdateJobSchema.safeParse(job).success).toBe(false);
    }
  });

  it("accepts only an expected version on a rollback request", () => {
    expect(pluginRollbackRequestSchema.parse({})).toEqual({});
    expect(
      pluginRollbackRequestSchema.parse({ expectedVersion: "1.0.0" }),
    ).toEqual({ expectedVersion: "1.0.0" });
    for (const body of [
      { expectedVersion: "" },
      { version: "1.0.0" },
      { expectedVersion: "1.0.0", force: true },
    ]) {
      expect(pluginRollbackRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});
