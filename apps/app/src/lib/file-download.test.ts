// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadNamedFile } from "./file-download";

function installObjectUrl(objectUrl = "blob:download"): {
  createObjectURL: ReturnType<typeof vi.spyOn>;
  revokeObjectURL: ReturnType<typeof vi.spyOn>;
} {
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue(objectUrl);
  const revokeObjectURL = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  return { createObjectURL, revokeObjectURL };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadNamedFile", () => {
  it("saves in-memory contents under the given file name without fetching", async () => {
    const { createObjectURL, revokeObjectURL } = installObjectUrl();
    let downloadedName: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        downloadedName = this.download;
      },
    );

    await downloadNamedFile({
      fileName: "notes.md",
      source: { kind: "contents", contents: "# Hello" },
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!(blob instanceof Blob)) {
      throw new Error("expected a Blob");
    }
    expect(blob.type).toBe("application/octet-stream");
    expect(await blob.text()).toBe("# Hello");
    expect(downloadedName).toBe("notes.md");
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });

  it("fetches a content url and saves the bytes under the given file name", async () => {
    const { createObjectURL } = installObjectUrl();
    let downloadedName: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        downloadedName = this.download;
      },
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["pdf-bytes"], { type: "application/pdf" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await downloadNamedFile({
      fileName: "report.pdf",
      source: { kind: "url", url: "/api/v1/files/report.pdf" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/files/report.pdf");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(downloadedName).toBe("report.pdf");
  });

  it("does not save a file when the content request fails", async () => {
    const { createObjectURL } = installObjectUrl();
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    await expect(
      downloadNamedFile({
        fileName: "missing.bin",
        source: { kind: "url", url: "/api/v1/files/missing.bin" },
      }),
    ).rejects.toThrow("File download failed with 404");

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
