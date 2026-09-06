import { describe, expect, it, vi } from "vitest";
import { captureBrowserPagePreview } from "./browser-capture-assembler";

function chunkingDesktopBrowser(bytes: Uint8Array) {
  return {
    experimental_browserControlVersion: 2 as const,
    experimental_captureBrowserPage: vi.fn(async () => ({
      navigationEpoch: 4,
      captureId: "cap-byte-assembler",
      format: "png" as const,
      pixelSize: { width: 2048, height: 2048 },
      byteLength: bytes.byteLength,
    })),
    experimental_readBrowserCaptureChunk: vi.fn(
      async (request: {
        captureId: string;
        tabId: string;
        offset: number;
        length: number;
      }) => {
        const end = Math.min(bytes.byteLength, request.offset + request.length);
        return {
          captureId: request.captureId,
          offset: request.offset,
          base64: Buffer.from(bytes.subarray(request.offset, end)).toString(
            "base64",
          ),
          eof: end === bytes.byteLength,
        };
      },
    ),
    experimental_releaseBrowserCapture: vi.fn(async () => undefined),
  };
}

const request = {
  tabId: "browser:a",
  format: "png" as const,
  quality: 85,
  expectedNavigationEpoch: 4,
};

describe("captureBrowserPagePreview", () => {
  it("rejects a legacy native runtime before capture", async () => {
    const { experimental_browserControlVersion: _, ...legacy } =
      chunkingDesktopBrowser(new Uint8Array([1]));
    await expect(captureBrowserPagePreview(legacy, request)).rejects.toThrow();
  });

  it("preserves more than 8 MiB of source bytes and revokes the owned preview", async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 17);
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = index % 251;
    const desktop = chunkingDesktopBrowser(bytes);
    const preview = await captureBrowserPagePreview(desktop, request);
    expect(desktop.experimental_captureBrowserPage).toHaveBeenCalledWith(
      {
        tabId: request.tabId,
        requestId: expect.any(String),
        format: request.format,
        quality: request.quality,
        expectedNavigationEpoch: request.expectedNavigationEpoch,
      },
      { signal: undefined },
    );
    try {
      const response = await fetch(preview.url);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(
        Buffer.compare(
          Buffer.from(await response.arrayBuffer()),
          Buffer.from(bytes),
        ),
      ).toBe(0);
      expect(desktop.experimental_releaseBrowserCapture).toHaveBeenCalledTimes(
        1,
      );
    } finally {
      preview.dispose();
      preview.dispose();
    }
    await expect(fetch(preview.url)).rejects.toThrow();
  });

  it("releases an invalid descriptor without allocating its advertised bytes", async () => {
    const desktop = chunkingDesktopBrowser(new Uint8Array([1]));
    const descriptor = await desktop.experimental_captureBrowserPage();
    desktop.experimental_captureBrowserPage.mockImplementation(async () => ({
      ...descriptor,
      byteLength: 1e12,
    }));
    await expect(captureBrowserPagePreview(desktop, request)).rejects.toThrow();
    expect(desktop.experimental_releaseBrowserCapture).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "malformed base64",
      captureId: "cap-byte-assembler",
      base64: "AQID!!!!",
      offset: 0,
      eof: true,
    },
    {
      name: "foreign resource",
      captureId: "foreign",
      base64: "AQI=",
      offset: 0,
      eof: true,
    },
    {
      name: "over-request data",
      captureId: "cap-byte-assembler",
      base64: "AQID",
      offset: 0,
      eof: true,
    },
    {
      name: "truncated data",
      captureId: "cap-byte-assembler",
      base64: "AQ==",
      offset: 0,
      eof: true,
    },
    {
      name: "non-progress data",
      captureId: "cap-byte-assembler",
      base64: "",
      offset: 0,
      eof: false,
    },
  ])(
    "rejects $name and releases the capture",
    async ({ name: _, ...chunk }) => {
      const desktop = chunkingDesktopBrowser(new Uint8Array([1, 2]));
      desktop.experimental_readBrowserCaptureChunk.mockImplementation(
        async () => chunk,
      );
      await expect(
        captureBrowserPagePreview(desktop, request),
      ).rejects.toThrow();
      expect(desktop.experimental_releaseBrowserCapture).toHaveBeenCalledTimes(
        1,
      );
    },
  );

  it("releases a late native allocation after cancellation", async () => {
    const desktop = chunkingDesktopBrowser(new Uint8Array([1, 2]));
    const descriptor = await desktop.experimental_captureBrowserPage();
    const controller = new AbortController();
    desktop.experimental_captureBrowserPage.mockImplementation(async () => {
      controller.abort();
      return descriptor;
    });
    await expect(
      captureBrowserPagePreview(desktop, {
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(desktop.experimental_releaseBrowserCapture).toHaveBeenCalledTimes(1);
  });
});
