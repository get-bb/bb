import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PlatformClient } from "../../../lib/remote/platform/client.js";
import { createRemoteArtifact, type RemoteArtifact } from "../../../lib/remote/types.js";
import { createMockRemote } from "../../../test/mock-remote/server.js";
import { registerPlatformHandlers } from "../../../test/mock-remote/platform/register.js";
import { createMockPlatformState } from "../../../test/mock-remote/platform/state.js";
import {
  createSbomExport,
  type SbomExportRequest,
} from "./export.js";

function remoteArtifact(bytes: Uint8Array, mediaType: string): RemoteArtifact {
  return createRemoteArtifact({
    service: "platform",
    mediaType,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    async *stream() {
      yield bytes.subarray(0, 3);
      yield bytes.subarray(3);
    },
  });
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    expect(chunk).toBeInstanceOf(Uint8Array);
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

describe("createSbomExport", () => {
  it("passes both frozen formats and both includeVex values directly to Platform", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const cyclonedx = Buffer.from('{"bomFormat":"CycloneDX"}\n');
    const spdx = Buffer.from('{"spdxVersion":"SPDX-2.3"}\n');
    const platform = {
      downloadSbom: vi.fn(async (input: { format: "cyclonedx" | "spdx"; includeVex: boolean; projectVersionId: string }) => {
        calls.push(input);
        return input.format === "cyclonedx"
          ? remoteArtifact(cyclonedx, "application/vnd.cyclonedx+json")
          : remoteArtifact(spdx, "application/spdx+json");
      }),
    };

    for (const format of ["cyclonedx-json", "spdx"] as const) {
      for (const includeVex of [true, false]) {
        const artifact = await createSbomExport(
          { platform },
          { projectVersionId: "pv-a87bd8e252b0", format, includeVex },
          new AbortController().signal,
        );
        expect(await collect(artifact.stream)).toEqual(format === "spdx" ? spdx : cyclonedx);
        expect(artifact).toMatchObject({
          contentType: format === "spdx" ? "application/spdx+json" : "application/vnd.cyclonedx+json",
          bytes: format === "spdx" ? spdx.byteLength : cyclonedx.byteLength,
        });
        expect(Object.keys(artifact).sort()).toEqual([
          "bytes",
          "contentType",
          "dispose",
          "filename",
          "stream",
        ]);
        await artifact.dispose();
      }
    }

    expect(calls).toEqual([
      { projectVersionId: "pv-a87bd8e252b0", format: "cyclonedx", includeVex: true },
      { projectVersionId: "pv-a87bd8e252b0", format: "cyclonedx", includeVex: false },
      { projectVersionId: "pv-a87bd8e252b0", format: "spdx", includeVex: true },
      { projectVersionId: "pv-a87bd8e252b0", format: "spdx", includeVex: false },
    ]);
  });

  it("rejects an unsupported runtime format with a typed error before Platform", async () => {
    const request: SbomExportRequest = {
      projectVersionId: "pv-1",
      format: "spdx",
      includeVex: true,
    };
    Reflect.set(request, "format", "spdx-xml");
    const platform = { downloadSbom: vi.fn() };

    await expect(
      createSbomExport({ platform }, request, new AbortController().signal),
    ).rejects.toEqual(expect.objectContaining({
      code: "SBOM_EXPORT_FORMAT_INVALID",
    }));
    expect(platform.downloadSbom).not.toHaveBeenCalled();
  });

  it("preserves the reviewed mock Platform CycloneDX and SPDX fixtures byte-for-byte", async () => {
    const fixtureRoot = resolve(import.meta.dirname, "../../../test/mock-remote/fixtures");
    const state = createMockPlatformState(fixtureRoot);
    const token = "platform-test-token";
    const harness = createMockRemote({
      platformToken: token,
      assuranceStudioKey: "unused",
      fixtureRoot,
      register(service, registry) {
        if (service === "platform") registerPlatformHandlers(registry, state);
      },
    });
    const client = new PlatformClient({
      baseUrl: "http://platform.mock",
      token,
      fetch: harness.platform.fetch,
    });
    const projectVersionId = String(
      [...state.versions.values()].find((version) => version.priorVersionId !== null)?.id,
    );

    try {
      for (const fixture of [
        { serviceFormat: "cyclonedx-json", platformFormat: "cyclonedx" },
        { serviceFormat: "spdx", platformFormat: "spdx" },
      ] as const) {
        const expectedResponse = await harness.platform.fetch(
          `http://platform.mock/public/v0/sboms/${fixture.platformFormat}/${projectVersionId}?includeVex=true`,
          { headers: { "X-Authorization": token } },
        );
        const expected = Buffer.from(await expectedResponse.arrayBuffer());
        const exported = await createSbomExport(
          { platform: client },
          { projectVersionId, format: fixture.serviceFormat, includeVex: true },
          new AbortController().signal,
        );
        expect(await collect(exported.stream)).toEqual(expected);
        expect(exported.contentType).toBe(expectedResponse.headers.get("content-type"));
        expect(exported.bytes).toBe(expected.byteLength);
        await exported.dispose();
      }
    } finally {
      await client.close();
      await harness.close();
    }
  });
});
