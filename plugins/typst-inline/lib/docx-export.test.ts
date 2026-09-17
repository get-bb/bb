// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTypstDocx,
  buildTypstDocxHtml,
  requestTypstDocx,
} from "./docx-export";
import type { TypstPage } from "./typst-pages";

const PAGE: TypstPage = { heightPt: 842, svg: "<svg/>", widthPt: 596 };

function pngBlob(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

describe("buildTypstDocxHtml", () => {
  it("fits each page image into the Word content box", () => {
    const html = buildTypstDocxHtml({
      images: ["data:image/png;base64,AAAA"],
      pages: [PAGE],
    });

    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("width: 601px");
    expect(html).toContain("height: 850px");
  });

  it("never upscales a page smaller than the Word content box", () => {
    const html = buildTypstDocxHtml({
      images: ["data:image/png;base64,AAAA"],
      pages: [{ heightPt: 100, svg: "<svg/>", widthPt: 200 }],
    });

    expect(html).toContain("width: 267px");
    expect(html).toContain("height: 133px");
  });
});

describe("requestTypstDocx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the page HTML to the core export route", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["docx"], { type: "application/vnd.ms-word" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await requestTypstDocx({
      fileName: "reports/report.typ",
      html: "<p>page</p>",
    });

    expect(blob).toBeInstanceOf(Blob);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/files/export");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      baseHref: null,
      content: "<p>page</p>",
      filename: "reports/report.typ",
      format: "docx",
      sourceKind: "html",
    });
  });

  it("surfaces the server error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "conversion failed",
      })),
    );

    await expect(
      requestTypstDocx({ fileName: "report.typ", html: "<p>page</p>" }),
    ).rejects.toThrow("conversion failed");
  });
});

describe("buildTypstDocx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries at a smaller raster scale when the images exceed the export budget", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["docx"], { type: "application/vnd.ms-word" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const rasterize = vi.fn(
      async (_pages: readonly TypstPage[], scale: number) =>
        scale === 2 ? [pngBlob(3_800_000)] : [pngBlob(8)],
    );

    const blob = await buildTypstDocx({
      fileName: "reports/report.typ",
      pages: [PAGE],
      rasterize,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(rasterize.mock.calls.map((call) => call[1])).toEqual([2, 1.5]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
