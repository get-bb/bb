import { describe, expect, it, vi } from "vitest";

import type { AsEntity } from "../types.js";
import { AssuranceStudioClient } from "./client.js";

describe("AssuranceStudioClient review regressions", () => {
  it("advances upstream page numbers across short nonterminal pages", async () => {
    const requestedPages: number[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      requestedPages.push(page);
      const first = (page - 1) * 30;
      return Response.json({
        success: true,
        data: {
          threats: Array.from({ length: 30 }, (_, index) => ({
            id: `threat-${first + index}`,
            project_id: "project-1",
          })),
          total: 120,
          has_more: page < 4,
        },
      });
    });
    const client = new AssuranceStudioClient({
      baseUrl: "https://as.example",
      apiKey: "as-secret",
      fetch,
    });

    const firstIterator = client.listEntities("threat", {
      projectId: "project-1",
      page: { pageSize: 50 },
    })[Symbol.asyncIterator]();
    const first = await firstIterator.next();
    expect(first.value?.items).toHaveLength(30);
    expect(first.value?.next).toEqual(expect.any(String));

    const ids = first.value?.items.map((item: AsEntity) => item.id) ?? [];
    for await (const page of client.listEntities("threat", {
      projectId: "project-1",
      page: { continuation: first.value?.next ?? "" },
    })) {
      ids.push(...page.items.map(item => item.id));
    }
    expect(requestedPages).toEqual([1, 1, 2, 3, 4]);
    expect(ids).toHaveLength(120);
    expect(new Set(ids)).toHaveLength(120);
    expect(ids.at(-1)).toBe("threat-119");
  });

  it("preserves a successful create when the review-status PATCH fails", async () => {
    const bodies: unknown[] = [];
    const methods: string[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (method === "POST") return Response.json({ success: true, data: {
        id: "threat-1",
        project_id: "project-1",
        review_version: "9007199254740993",
        review_status: "pending",
      } });
      if (method === "PATCH") return Response.json({ error: "review update failed" }, {
        status: 500,
      });
      return Response.json({ success: true, data: {
        id: "threat-1",
        project_id: "project-1",
        review_version: "9007199254740993",
        review_status: "pending",
      } });
    });
    const client = new AssuranceStudioClient({
      baseUrl: "https://as.example",
      apiKey: "as-secret",
      fetch,
    });

    await expect(client.createEntity("threat", {
      projectId: "project-1",
      fields: { name: "Threat", review_status: "human_approved" },
    })).resolves.toMatchObject({
      success: true,
      entity: { id: "threat-1", reviewStatus: "pending" },
      reviewStatusSet: false,
      reviewStatusReason: "Review status PATCH failed after the entity was created",
    });
    expect(methods).toEqual(["POST", "PATCH", "GET"]);
    expect(bodies).toEqual([
      { name: "Threat" },
      { review_status: "human_approved", review_version: "9007199254740993" },
    ]);
  });

  it("maps lossless DataFlow PATCH aliases and requires review concurrency", async () => {
    const bodies: unknown[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return Response.json({ success: true, data: {
        id: "flow-1",
        project_id: "project-1",
        review_version: "9007199254740994",
      } });
    });
    const client = new AssuranceStudioClient({
      baseUrl: "https://as.example",
      apiKey: "as-secret",
      fetch,
    });

    await expect(client.updateEntity("dataflow", {
      projectId: "project-1",
      id: "flow-1",
      fields: {
        source_component_id: "component-a",
        target_component_id: "component-b",
        is_encrypted: true,
        is_authenticated: false,
        reviewVersion: "9007199254740993",
      },
    })).resolves.toMatchObject({ success: true, entity: { id: "flow-1" } });
    expect(bodies).toEqual([{
      from_component: "component-a",
      to_component: "component-b",
      encrypted: true,
      authenticated: false,
      review_version: "9007199254740993",
    }]);

    await expect(client.updateEntity("threat", {
      projectId: "project-1",
      id: "threat-1",
      fields: { description: "unsafe without a concurrency token" },
    })).rejects.toMatchObject({ code: "AS_REVIEW_VERSION_REQUIRED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps strict AS request-key rejection visible", async () => {
    const fetch = vi.fn(async () => Response.json({
      error: "Unrecognized key",
      field: "unexpected_field",
    }, { status: 400 }));
    const client = new AssuranceStudioClient({
      baseUrl: "https://as.example",
      apiKey: "as-secret",
      fetch,
    });

    await expect(client.createEntity("threat", {
      projectId: "project-1",
      fields: { name: "Threat", unexpected_field: true },
    })).rejects.toMatchObject({
      service: "assurance-studio",
      code: "REMOTE_HTTP_400",
      status: 400,
      details: { error: "Unrecognized key", field: "unexpected_field" },
    });
  });
});
