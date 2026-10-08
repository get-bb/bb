import { describe, expect, it } from "vitest";
import {
  startCatalogPluginInstall,
  startPluginInstall,
} from "./plugin-install-job-queries";

function recordingFetch(body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

describe("starting plugin installs", () => {
  it("asks the direct install endpoint for a job", async () => {
    const job = {
      id: "job-1",
      target: {
        kind: "source",
        source: "./plugins/local",
        selection: { kind: "root" },
      },
      displayName: "./plugins/local",
      state: "queued",
    };
    const { fetchImpl, calls } = recordingFetch({ ok: true, job });
    await expect(
      startPluginInstall(fetchImpl, "./plugins/local"),
    ).resolves.toEqual(job);
    expect(calls[0]?.url).toBe("/api/v1/plugins/install");
    expect(new Headers(calls[0]?.init?.headers).get("prefer")).toBe(
      "respond-async",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      source: "./plugins/local",
    });
  });

  it("asks the catalog endpoint for a job", async () => {
    const job = {
      id: "job-2",
      target: {
        kind: "catalog",
        entryId: "linear",
        marketplace: "bb-official",
      },
      displayName: "Linear",
      state: "running",
    };
    const { fetchImpl, calls } = recordingFetch({ ok: true, job });
    await expect(
      startCatalogPluginInstall(fetchImpl, { entryId: "linear" }),
    ).resolves.toEqual(job);
    expect(calls[0]?.url).toBe("/api/v1/plugin-catalog/install");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      entryId: "linear",
    });
  });
});
