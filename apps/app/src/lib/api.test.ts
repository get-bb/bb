import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_PREVIEW_TEXT_MAX_BYTES } from "@bb/client-core";
import { loadFilePreview } from "./api";

const target = {
  name: "report.bin",
  path: "qa/report.bin",
  url: "/api/v1/raw/qa/report.bin",
};
const fetchMock = vi.fn();

function partialResponse(
  body: Uint8Array<ArrayBuffer> | string,
  contentType: string,
  sizeBytes: number,
): Response {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes, {
    status: 206,
    headers: {
      "content-range": `bytes 0-${bytes.byteLength - 1}/${sizeBytes}`,
      "content-type": contentType,
    },
  });
}

function requestedRange(callIndex: number): string | null {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get("range");
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("loadFilePreview", () => {
  it("describes a large binary from its first bytes without reading the rest", async () => {
    fetchMock.mockResolvedValueOnce(
      partialResponse(
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]),
        "application/zip",
        90_000_000,
      ),
    );

    const preview = await loadFilePreview(target);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedRange(0)).toBe("bytes=0-65535");
    expect(preview).toMatchObject({
      kind: "unsupported",
      reason: "binary",
      sizeBytes: 90_000_000,
      url: target.url,
    });
  });

  it("fetches the whole file only after the sample shows text", async () => {
    fetchMock
      .mockResolvedValueOnce(partialResponse("line 1\n", "text/plain", 200_000))
      .mockResolvedValueOnce(
        new Response("line 1\nline 2\n", {
          headers: { "content-type": "text/plain" },
        }),
      );

    const preview = await loadFilePreview(target);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedRange(1)).toBeNull();
    expect(preview).toMatchObject({
      kind: "text",
      content: "line 1\nline 2\n",
    });
  });

  it("does not download text past the preview limit", async () => {
    fetchMock.mockResolvedValueOnce(
      partialResponse("log\n", "text/plain", FILE_PREVIEW_TEXT_MAX_BYTES + 1),
    );

    const preview = await loadFilePreview(target);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(preview).toMatchObject({ kind: "unsupported", reason: "too-large" });
  });

  it("uses the sample as the whole file when it covers it", async () => {
    fetchMock.mockResolvedValueOnce(
      partialResponse("short\n", "text/plain", "short\n".length),
    );

    const preview = await loadFilePreview(target);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(preview).toMatchObject({ kind: "text", content: "short\n" });
  });

  it("treats an unsatisfiable first range as an empty file", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 416,
        headers: {
          "content-range": "bytes */0",
          "content-type": "text/plain",
        },
      }),
    );

    const preview = await loadFilePreview(target);

    expect(preview).toMatchObject({ kind: "text", content: "" });
  });
});
