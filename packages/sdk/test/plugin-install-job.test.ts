import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

const installedPlugin = {
  id: "notes",
  source: "npm:@bb/notes@^1",
  rootDir: "/plugins/notes",
  version: "1.2.0",
  provenance: "catalog" as const,
  isOrphanedBuiltin: false,
  catalogEntryId: "notes",
  publisherLabel: "BB Community",
  sourceDisplay: "npm · @bb/notes · tracks compatible",
  updateState: {},
  enabled: true,
  description: "Notes",
  name: "Notes",
  screenshots: [],
  collections: [],
  icon: null,
  iconUrl: null,
  status: "running" as const,
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
  providerIds: [],
  icons: {},
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createJobServerSdk(polledJobs: readonly unknown[]): {
  sdk: ReturnType<typeof createBbSdk>;
  urls: string[];
  preferences: (string | null)[];
} {
  const urls: string[] = [];
  const preferences: (string | null)[] = [];
  let poll = 0;
  const fetch: FetchImplementation = (input, init) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/install-jobs/job-1")) {
      const job = polledJobs[Math.min(poll, polledJobs.length - 1)];
      poll += 1;
      return Promise.resolve(jsonResponse({ ok: true, job }, 200));
    }
    preferences.push(new Headers(init?.headers).get("prefer"));
    return Promise.resolve(
      jsonResponse({ ok: true, job: { id: "job-1", state: "running" } }, 202),
    );
  };
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  return { sdk, urls, preferences };
}

describe("plugin install against a server that answers with a job", () => {
  it("asks for a job, then polls until it succeeds and returns the plugin", async () => {
    const { sdk, urls, preferences } = createJobServerSdk([
      { id: "job-1", state: "running" },
      { id: "job-1", state: "succeeded", plugin: installedPlugin },
    ]);

    await expect(
      sdk.plugins.install({ source: "npm:@bb/notes@^1" }),
    ).resolves.toMatchObject({ id: "notes", status: "running" });
    expect(preferences).toEqual(["respond-async"]);
    expect(urls).toEqual([
      "http://bb.test/api/v1/plugins/install",
      "http://bb.test/api/v1/plugins/install-jobs/job-1",
      "http://bb.test/api/v1/plugins/install-jobs/job-1",
    ]);
  });

  it("rejects with the failed job's error", async () => {
    const { sdk } = createJobServerSdk([
      { id: "job-1", state: "failed", error: "npm install failed (exit 1)" },
    ]);

    await expect(
      sdk.plugins.install({ source: "npm:@bb/notes@^1" }),
    ).rejects.toThrow("npm install failed (exit 1)");
  });

  it("follows the job for a catalog install too", async () => {
    const { sdk, urls, preferences } = createJobServerSdk([
      { id: "job-1", state: "succeeded", plugin: installedPlugin },
    ]);

    await expect(
      sdk.plugins.catalog.install({ entryId: "notes" }),
    ).resolves.toMatchObject({ id: "notes" });
    expect(preferences).toEqual(["respond-async"]);
    expect(urls[0]).toBe("http://bb.test/api/v1/plugin-catalog/install");
  });
});
