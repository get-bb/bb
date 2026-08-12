import { describe, expect, it, vi } from "vitest";

import { PlatformClient } from "./client.js";

describe("PlatformClient review regressions", () => {
  it("rejects injected RSQL scalars before transport and pages embedded comments", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      items: [{
        id: "f1",
        comments: [{ text: "one" }, { text: "two" }, { text: "three" }],
      }],
      total: 1,
    }));
    const client = new PlatformClient({
      baseUrl: "https://platform.example",
      token: "platform-secret",
      fetch,
    });

    await expect(client.getFindingDetail({
      projectVersionId: "pv1",
      findingId: "1,projectVersion==OTHER",
    })).rejects.toMatchObject({ code: "PLATFORM_INVALID_RSQL" });
    expect(fetch).not.toHaveBeenCalled();

    const firstIterator = client.listFindingComments({
      projectVersionId: "pv1",
      findingId: "CVE-2026-1",
      page: { pageSize: 2 },
    })[Symbol.asyncIterator]();
    const first = await firstIterator.next();
    expect(first.value).toEqual({
      items: [{ text: "one" }, { text: "two" }],
      total: 3,
      next: expect.any(String),
    });

    const resumed = client.listFindingComments({
      projectVersionId: "pv1",
      findingId: "CVE-2026-1",
      page: { continuation: first.value?.next ?? undefined },
    })[Symbol.asyncIterator]();
    expect((await resumed.next()).value).toEqual({
      items: [{ text: "three" }],
      total: 3,
      next: null,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const requested = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("filter")).toBe(
      "projectVersion==pv1;findingId==CVE-2026-1",
    );
  });

  it("preserves ordered per-item partial VEX outcomes", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      status: "partial_success",
      summary: { total: 2, succeeded: 1, failed: 1 },
      results: [
        { findingId: "101", success: true, status: "IN_TRIAGE" },
        { findingId: "202", success: false, status: null, error: "not found" },
      ],
    }));
    const client = new PlatformClient({
      baseUrl: "https://platform.example",
      token: "platform-secret",
      fetch,
    });

    await expect(client.batchSetVexStatus({
      projectVersionId: "pv1",
      findings: [
        { findingId: "101", status: "IN_TRIAGE" },
        { findingId: "202", status: "NOT_AFFECTED" },
      ],
    })).resolves.toEqual({
      status: "partial_success",
      summary: { total: 2, succeeded: 1, failed: 1 },
      results: [
        { findingId: "101", success: true, status: "IN_TRIAGE", error: null },
        { findingId: "202", success: false, status: null, error: "not found" },
      ],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      findings: [
        { findingId: "101", status: "IN_TRIAGE" },
        { findingId: "202", status: "NOT_AFFECTED" },
      ],
    });
  });

  it("fails the scan-only firmware variant closed before transport", async () => {
    const fetch = vi.fn();
    const client = new PlatformClient({
      baseUrl: "https://platform.example",
      token: "platform-secret",
      fetch,
    });
    await expect(client.getFirmwareFile({
      fromScanId: "scan-1",
      fileHash: "a".repeat(64),
      mode: "full",
    })).rejects.toMatchObject({
      code: "PLATFORM_FIRMWARE_PROJECT_VERSION_REQUIRED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
