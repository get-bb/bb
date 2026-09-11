import {
  createConnection,
  listInstalledPlugins,
  migrate,
  type DbConnection,
} from "@bb/db";
import type { PluginListingDraftEntry } from "@bb/domain";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPluginListingRoutes } from "../../../src/routes/plugin-listings.js";

const entry: PluginListingDraftEntry = {
  id: "review-notes",
  displayName: "Review Notes",
  description: "Collect review notes.",
  author: { name: "Reviewer" },
  icon: "Notebook",
  source: { npm: { package: "bb-plugin-review-notes", range: "^1.0.0" } },
};

describe("authored plugin listing routes and SDK", () => {
  let db: DbConnection;
  let app: Hono;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    const routes = new Hono();
    registerPluginListingRoutes(routes, {
      db,
      config: { serverPort: 3000 },
      notifyChanged: () => {},
      fetch: async () => {
        throw new Error("unexpected external request");
      },
    });
    app = new Hono().route("/api/v1", routes);
  });

  afterEach(() => db.$client.close());

  function sdk() {
    return createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://localhost:3000",
        runtime: "node",
        fetch: (input, init) => app.request(input, init),
      }),
    });
  }

  it("round-trips an authored-only draft without creating a runtime and accepts repeated saves", async () => {
    const plugins = sdk().plugins;
    expect(await plugins.listings.list()).toEqual({ records: [], notices: [] });
    const record = await plugins.listings.saveDraft({
      pluginId: entry.id,
      entry,
    });
    expect(record).toMatchObject({
      authorship: "explicit",
      lifecycle: { status: "draft" },
    });
    expect(
      await plugins.listings.saveDraft({ pluginId: entry.id, entry }),
    ).toEqual(record);
    expect(await plugins.listings.list()).toEqual({
      records: [record],
      notices: [],
    });
    expect(listInstalledPlugins(db)).toEqual([]);
    expect(await plugins.listings.consumeNotice({ noticeId: "missing" })).toBe(
      false,
    );
  });

  it("rejects mismatched plugin identity and leaves ownership empty", async () => {
    await expect(
      sdk().plugins.listings.saveDraft({
        pluginId: "somebody-elses-plugin",
        entry,
      }),
    ).rejects.toThrow("same id");
    expect(await sdk().plugins.listings.list()).toEqual({
      records: [],
      notices: [],
    });
  });

  it("rejects cross-origin ownership mutation", async () => {
    const response = await app.request(
      "http://localhost:3000/api/v1/plugins/review-notes/listing/draft",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ entry }),
      },
    );
    expect(response.status).toBe(403);
    expect(await sdk().plugins.listings.list()).toEqual({
      records: [],
      notices: [],
    });
  });

  it("rejects bundled ownership and unrelated pull request repositories at the boundary", async () => {
    const response = await app.request(
      "/api/v1/plugins/review-notes/listing/draft",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entry: { ...entry, source: { bundled: { plugin: entry.id } } },
        }),
      },
    );
    expect(response.status).toBe(422);
    await sdk().plugins.listings.saveDraft({ pluginId: entry.id, entry });
    await expect(
      sdk().plugins.listings.recordSubmission({
        pluginId: entry.id,
        pullRequestUrl: "https://github.com/reviewer/marketplace/pull/123",
      }),
    ).rejects.toThrow("get-bb/marketplace");
  });
});
