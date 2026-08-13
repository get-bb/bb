import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AssuranceStudioClient } from "../../../lib/remote/assurance-studio/client.js";
import { registerMockAssuranceStudio } from "../assurance-studio/register.js";
import { registerFindingHandlers } from "../platform/findings.js";
import { createMockPlatformState } from "../platform/state.js";
import { createMockRemote, type MockRemoteHarness } from "../server.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));
const platformToken = "quirk-platform-token";
const asKey = "quirk-as-key";
let harness: MockRemoteHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe("raw owner-bound live-drift quirks", () => {
  it("keeps Platform CVEs as a dictionary and severity counts in their raw wrapper", async () => {
    const state = createMockPlatformState(fixtureRoot);
    harness = createMockRemote({
      platformToken,
      assuranceStudioKey: asKey,
      fixtureRoot,
      register(service, registry) {
        if (service === "platform") registerFindingHandlers(registry, state);
      },
    });
    const headers = { "X-Authorization": platformToken };
    const detail = await harness.platform.fetch(
      "http://platform.mock/public/v0/findings?filter=projectVersion%3D%3Dpv-a481df87dadf%3BfindingId%3D%3D8000000000000000000&limit=1&includeAdditionalDetails=true&includeComments=true",
      { headers },
    ).then((response) => response.json()) as Record<string, unknown>[];
    const first = detail[0] ?? {};
    expect(first.cves).toEqual({ "CVE-2020-10000": { cvss: 9.8, source: "NVD" } });
    expect(Array.isArray(first.cves)).toBe(false);

    const severity = await harness.platform.fetch(
      "http://platform.mock/public/v0/project/version/pv-a481df87dadf/findings/severities/counts",
      { headers },
    ).then((response) => response.json());
    expect(severity).toEqual({
      bySeverity: { critical: 1_000, high: 1_000, medium: 1_000, low: 1_000 },
      total: 4_000,
    });
  });

  it("preserves the exact CSV trailer bytes at the Platform owner boundary", () => {
    const bytes = readFileSync(new URL("../fixtures/platform/vex-export.csv", import.meta.url));
    expect(bytes.subarray(-33).toString("utf8")).toBe("# rows_written=25 rows_skipped=2\n");
    expect(bytes.toString("utf8").split("\n").at(-2)).toBe("# rows_written=25 rows_skipped=2");
  });

  it("keeps AS camelCase list casing and one-based paging while the client fully drains", async () => {
    harness = createMockRemote({
      platformToken,
      assuranceStudioKey: asKey,
      fixtureRoot,
      register(service, registry) {
        if (service === "assurance-studio") registerMockAssuranceStudio(registry, fixtureRoot);
      },
    });
    const raw = await harness.assuranceStudio.fetch(
      "http://as.mock/api/projects/project-4a752600a07a/components?page=1&limit=5",
      { headers: { "X-API-Key": asKey } },
    ).then((response) => response.json()) as {
      success: boolean;
      data: { page: number; pageSize: number; items: Record<string, unknown>[] };
    };
    expect(raw.success).toBe(true);
    expect(raw.data).toMatchObject({ page: 1, pageSize: 5 });
    expect(raw.data.items[0]).toMatchObject({
      human_edited: true,
      project_id: "project-4a752600a07a",
      review_status: "human_approved",
      review_version: "9007199254740993",
    });
    expect(raw.data.items[0]).not.toHaveProperty("humanEdited");

    const client = new AssuranceStudioClient({
      baseUrl: "http://as.mock", apiKey: asKey, fetch: harness.assuranceStudio.fetch,
    });
    const pages = [];
    for await (const page of client.listEntities("component", {
      projectId: "project-4a752600a07a", page: { pageSize: 5 },
    })) pages.push(page);
    expect(pages.map((page) => page.items.length)).toEqual([5, 5, 2]);
    expect(pages.at(-1)?.next).toBeNull();
    client.close();
  });
});
