import { describe, expect, it, vi } from "vitest";
import { fetchServerAttention } from "../src/server-attention.js";

describe("fetchServerAttention", () => {
  it("returns the typed attention state", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ hasAttention: true }));

    await expect(
      fetchServerAttention({
        fetchImpl,
        serverUrl: "https://studio.example/base",
        timeoutMs: 1_000,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://studio.example/api/v1/system/attention",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns null for unavailable or incompatible responses", async () => {
    await expect(
      fetchServerAttention({
        fetchImpl: async () => new Response("not found", { status: 404 }),
        serverUrl: "https://old.example",
        timeoutMs: 1_000,
      }),
    ).resolves.toBeNull();

    await expect(
      fetchServerAttention({
        fetchImpl: async () => Response.json({ hasAttention: "yes" }),
        serverUrl: "https://wrong.example",
        timeoutMs: 1_000,
      }),
    ).resolves.toBeNull();
  });
});
