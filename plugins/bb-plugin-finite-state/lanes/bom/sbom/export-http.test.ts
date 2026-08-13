import { createHash } from "node:crypto";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRemoteArtifact,
  RemoteError,
  type PlatformClient,
  type RemoteArtifact,
} from "../../../lib/remote/types.js";
import { createSbomHttpHandler } from "./export-http.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function artifact(input: {
  bytes: Uint8Array;
  mediaType?: string;
  size?: number | null;
  onFinally?: () => void;
  failAfterFirst?: boolean;
}): RemoteArtifact {
  return createRemoteArtifact({
    service: "platform",
    mediaType: input.mediaType ?? "application/vnd.cyclonedx+json",
    size: input.size === undefined ? input.bytes.byteLength : input.size,
    sha256: input.failAfterFirst
      ? null
      : createHash("sha256").update(input.bytes).digest("hex"),
    async *stream() {
      try {
        yield input.bytes.subarray(0, Math.min(input.bytes.byteLength, 64 * 1024));
        if (input.failAfterFirst) throw new Error("/private/upstream/token=secret");
        if (input.bytes.byteLength > 64 * 1024) yield input.bytes.subarray(64 * 1024);
      } finally {
        input.onFinally?.();
      }
    },
  });
}

function setup(downloadSbom: PlatformClient["downloadSbom"]) {
  const host = createFakePluginHost({ pluginId: "finite-state" });
  hosts.push(host);
  host.bb.http.route(
    "GET",
    "/sbom/export",
    createSbomHttpHandler({ platform: { downloadSbom } }),
    { auth: "local" },
  );
  return host;
}

describe("SBOM export HTTP", () => {
  it("keeps local auth and streams byte-identical content with audited headers", async () => {
    const bytes = Buffer.from('{"bomFormat":"CycloneDX"}\n');
    const downloadSbom = vi.fn(async () => artifact({ bytes }));
    const host = setup(downloadSbom);

    expect(host.harness.registrations.httpRoutes).toEqual([
      expect.objectContaining({ method: "GET", path: "/sbom/export", auth: "local" }),
    ]);
    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/sbom/export?projectVersionId=pv-1&format=cyclonedx-json",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.cyclonedx+json");
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="finite-state-sbom.cdx.json"');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(downloadSbom).toHaveBeenCalledWith(
      { projectVersionId: "pv-1", format: "cyclonedx", includeVex: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("never reflects a malicious project version into Content-Disposition", async () => {
    const host = setup(async () => artifact({
      bytes: Buffer.from("{}\n"),
      mediaType: "application/spdx+json",
    }));
    const malicious = encodeURIComponent('pv-1"\r\nX-Evil: injected');
    const response = await host.harness.behavior.fetchHttp(
      "GET",
      `/sbom/export?projectVersionId=${malicious}&format=spdx&includeVex=false`,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain("X-Evil");
  });

  it("streams a large artifact incrementally with known length and bounded pulls", async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const chunks = 128;
    let yielded = 0;
    let activePulls = 0;
    let maxActivePulls = 0;
    const remote = createRemoteArtifact({
      service: "platform",
      mediaType: "application/spdx+json",
      size: chunk.byteLength * chunks,
      sha256: null,
      async *stream() {
        for (let index = 0; index < chunks; index += 1) {
          activePulls += 1;
          maxActivePulls = Math.max(maxActivePulls, activePulls);
          await Promise.resolve();
          yielded += 1;
          activePulls -= 1;
          yield chunk;
        }
      },
    });
    const host = setup(async () => remote);
    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/sbom/export?projectVersionId=pv-1&format=spdx&includeVex=true",
    );
    expect(response.headers.get("content-length")).toBe(String(chunk.byteLength * chunks));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader?.read();
    expect(first?.value?.byteLength).toBe(chunk.byteLength);
    expect(yielded).toBeLessThan(chunks);
    let total = first?.value?.byteLength ?? 0;
    while (true) {
      const next = await reader?.read();
      if (!next || next.done) break;
      total += next.value.byteLength;
    }
    expect(total).toBe(chunk.byteLength * chunks);
    expect(maxActivePulls).toBe(1);
  });

  it("fails a reset stream closed and releases its request-owned resource", async () => {
    let released = false;
    const host = setup(async () => artifact({
      bytes: Buffer.alloc(128 * 1024, 0x62),
      failAfterFirst: true,
      onFinally: () => { released = true; },
    }));
    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/sbom/export?projectVersionId=pv-1&format=cyclonedx-json&includeVex=true",
    );
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(released).toBe(true);
  });

  it("aborts upstream iteration when the client disconnects mid-stream", async () => {
    let released = false;
    let upstreamSignal: AbortSignal | undefined;
    const host = setup(async (_input, context) => {
      upstreamSignal = context?.signal;
      return createRemoteArtifact({
        service: "platform",
        mediaType: "application/vnd.cyclonedx+json",
        size: null,
        sha256: null,
        async *stream() {
          try {
            yield Buffer.alloc(64 * 1024, 0x63);
            await new Promise<void>((resolve) => {
              if (context?.signal?.aborted) resolve();
              else context?.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          } finally {
            released = true;
          }
        },
      });
    });
    const client = new AbortController();
    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/sbom/export?projectVersionId=pv-1&format=cyclonedx-json",
      { signal: client.signal },
    );
    const reader = response.body?.getReader();
    await reader?.read();
    client.abort();
    await reader?.cancel();

    expect(upstreamSignal?.aborted).toBe(true);
    expect(released).toBe(true);
  });

  it("maps typed Platform failures without reflecting paths or raw exceptions", async () => {
    const host = setup(async () => {
      throw new RemoteError("token=secret at /Users/private/export", {
        service: "platform",
        code: "REMOTE_RATE_LIMITED",
        status: 429,
        retryable: true,
        retryAfterMs: 2_500,
        details: { path: "/Users/private/export" },
      });
    });
    const response = await host.harness.behavior.fetchHttp(
      "GET",
      "/sbom/export?projectVersionId=pv-1&format=spdx",
    );
    const text = await response.text();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(text).toContain("REMOTE_RATE_LIMITED");
    expect(text).not.toMatch(/secret|\/Users|private/iu);
  });
});
