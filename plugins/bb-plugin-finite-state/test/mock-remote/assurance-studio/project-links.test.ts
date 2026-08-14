import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AssuranceStudioClient } from "../../../lib/remote/assurance-studio/client.js";
import { createMockRemote, type MockRemoteHarness } from "../server.js";
import { registerMockAssuranceStudio } from "./register.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));
const apiKey = "as-project-link-key";
let harness: MockRemoteHarness | null = null;

function setup(): {
  harness: MockRemoteHarness;
  client: AssuranceStudioClient;
} {
  harness = createMockRemote({
    platformToken: "unused-platform-token",
    assuranceStudioKey: apiKey,
    fixtureRoot,
    register(service, registry) {
      if (service === "assurance-studio") {
        registerMockAssuranceStudio(registry, fixtureRoot);
      }
    },
  });
  return {
    harness,
    client: new AssuranceStudioClient({
      baseUrl: "http://as.mock",
      apiKey,
      fetch: harness.assuranceStudio.fetch,
    }),
  };
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe("Assurance Studio project-link enumeration", () => {
  it("mirrors the captured wire and preserves 4-way and 2-way ambiguity", async () => {
    const { client, harness: remote } = setup();
    const raw = await remote.assuranceStudio.fetch(
      "http://as.mock/api/projects/as-project-a1/fs-links",
      { headers: { "X-API-Key": apiKey } },
    );
    expect(raw.status).toBe(200);
    const wire = (await raw.json()) as {
      success: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(wire.success).toBe(true);
    expect(Object.keys(wire.data[0] ?? {}).sort()).toEqual([
      "created_at",
      "created_by",
      "critical_vuln_count",
      "fs_product_id",
      "fs_product_name",
      "fs_version_id",
      "fs_version_name",
      "id",
      "is_primary",
      "last_synced_at",
      "organization_id",
      "project_id",
      "sbom_component_count",
      "source_type",
      "summary",
      "sync_error",
      "sync_status",
      "updated_at",
      "version_strategy",
      "vulnerability_count",
    ]);

    const projectA = [];
    for await (const page of client.listProjectLinks({
      platformProjectId: "platform-project-a",
      page: { pageSize: 2 },
    })) {
      projectA.push(...page.items);
    }
    expect(projectA).toHaveLength(4);
    expect(
      new Set(projectA.map((candidate) => candidate.assuranceStudioProjectId))
        .size,
    ).toBe(4);
    expect(
      new Set(projectA.map((candidate) => candidate.platformProjectVersionId)),
    ).toEqual(new Set(["platform-version-a"]));
    expect(projectA.every((candidate) => candidate.isPrimary)).toBe(true);

    const projectB = [];
    for await (const page of client.listProjectLinks({
      platformProjectId: "platform-project-b",
    })) {
      projectB.push(...page.items);
    }
    expect(projectB).toHaveLength(2);
    expect(
      projectB.every((candidate) => candidate.syncStatus === "synced"),
    ).toBe(true);

    const projectC = [];
    for await (const page of client.listProjectLinks({
      platformProjectId: "platform-project-c",
    })) {
      projectC.push(...page.items);
    }
    expect(projectC).toHaveLength(1);
    expect(projectC[0]?.assuranceStudioProjectId).toBe("as-project-c1");

    const unlinked = [];
    for await (const page of client.listProjectLinks({
      platformProjectId: "platform-project-unlinked",
    })) {
      unlinked.push(...page.items);
    }
    expect(unlinked).toEqual([]);
  });

  it("resumes candidate paging without changing the explicit candidate set", async () => {
    const { client } = setup();
    const first = await client
      .listProjectLinks({
        platformProjectId: "platform-project-a",
        page: { pageSize: 3 },
      })
      [Symbol.asyncIterator]()
      .next();
    expect(first.value?.items).toHaveLength(3);
    expect(first.value?.next).toEqual(expect.any(String));

    const resumed = [];
    for await (const page of client.listProjectLinks({
      platformProjectId: "platform-project-a",
      page: { continuation: first.value?.next ?? "" },
    })) {
      resumed.push(...page.items);
    }
    expect(
      resumed.map((candidate) => candidate.assuranceStudioProjectId),
    ).toEqual(["as-project-a4"]);
  });

  it.each([
    [
      "cross-project scope",
      { project_id: "spoofed-project", is_primary: true },
      "AS_PROJECT_LINK_SCOPE_MISMATCH",
    ],
    [
      "non-boolean primary",
      { project_id: "as-project-a1", is_primary: "true" },
      "AS_INVALID_PROJECT_LINK",
    ],
    [
      "timestamp without an offset",
      {
        project_id: "as-project-a1",
        last_synced_at: "2026-08-14T12:00:00",
      },
      "AS_INVALID_PROJECT_LINK",
    ],
  ])(
    "rejects %s in the live boundary shape",
    async (_label, overrides, code) => {
      const fetch = async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/projects") {
          return Response.json({
            success: true,
            data: {
              items: [{ id: "as-project-a1", name: "AS Project A1" }],
              total: 1,
              page: 1,
              pageSize: 200,
              hasMore: false,
            },
          });
        }
        const link: Record<string, unknown> = {
          id: "link-a1",
          project_id: "as-project-a1",
          fs_product_id: "platform-project-a",
          fs_product_name: "Platform Project A",
          fs_version_id: "platform-version-a",
          fs_version_name: null,
          is_primary: true,
          sync_status: "synced",
          last_synced_at: null,
          version_strategy: "specific",
        };
        Object.assign(link, overrides);
        return Response.json({
          success: true,
          data: [link],
        });
      };
      const client = new AssuranceStudioClient({
        baseUrl: "http://as.mock",
        apiKey,
        fetch,
      });
      const consume = async () => {
        for await (const _page of client.listProjectLinks({
          platformProjectId: "platform-project-a",
        })) {
          // Boundary parsing happens before a page can be yielded.
        }
      };
      await expect(consume()).rejects.toMatchObject({ code });
    },
  );

  it("fails with a typed refusal before more than 1,000 candidates reach RPC validation", async () => {
    const links = Array.from({ length: 1_001 }, (_, index) => ({
      id: `link-${index}`,
      project_id: "as-project-limit",
      fs_product_id: "platform-project-limit",
      fs_product_name: "Platform Project Limit",
      fs_version_id: "platform-version-limit",
      fs_version_name: "Version Limit",
      is_primary: true,
      sync_status: "synced",
      last_synced_at: "2026-08-14T12:00:00.000Z",
      version_strategy: "specific",
    }));
    const client = new AssuranceStudioClient({
      baseUrl: "http://as.mock",
      apiKey,
      fetch: async (input) => {
        const url = new URL(String(input));
        return url.pathname === "/api/projects"
          ? Response.json({
              success: true,
              data: {
                items: [{ id: "as-project-limit", name: "AS Project Limit" }],
                total: 1,
                page: 1,
                pageSize: 200,
                hasMore: false,
              },
            })
          : Response.json({ success: true, data: links });
      },
    });
    const consume = async () => {
      for await (const _page of client.listProjectLinks({
        platformProjectId: "platform-project-limit",
      })) {
        // The client must reject before yielding an oversized candidate page.
      }
    };
    await expect(consume()).rejects.toMatchObject({
      code: "AS_PROJECT_CANDIDATE_LIMIT",
      details: { maxCandidates: 1_000 },
    });
  });
});
