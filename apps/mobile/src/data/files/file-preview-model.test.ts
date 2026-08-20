import type { FilePreview } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  buildCsvPreviewData,
  buildFileLineSelectionText,
  formatFileLineReference,
  formatFileSize,
  parseCsvRows,
  resolveFilePreviewContent,
  splitPreviewLines,
  truncateFilePreviewCode,
} from "./file-preview-model";

function textPreview(
  path: string,
  content: string,
  mimeType = "text/plain",
): FilePreview {
  return {
    kind: "text",
    path,
    name: path.split("/").at(-1),
    url: "u",
    mimeType,
    content,
  };
}

const base = {
  activePath: "src/a.ts",
  error: null,
  isLoading: false,
  htmlRawUrl: null,
};

describe("resolveFilePreviewContent", () => {
  it("is loading until the preview for the active path arrives", () => {
    expect(resolveFilePreviewContent({ ...base, preview: undefined })).toEqual({
      kind: "loading",
    });
    expect(
      resolveFilePreviewContent({
        ...base,
        preview: textPreview("src/other.ts", "x"),
      }),
    ).toEqual({ kind: "loading" });
  });

  it("maps 404 / 413 / other errors", () => {
    const notFound = new BbHttpError({
      body: null,
      code: "ENOENT",
      message: "m",
      status: 404,
    });
    expect(
      resolveFilePreviewContent({
        ...base,
        preview: undefined,
        error: notFound,
      }),
    ).toEqual({ kind: "not-found" });
    const tooLarge = new BbHttpError({
      body: null,
      code: "file_too_large",
      message: "x",
      status: 413,
    });
    expect(
      resolveFilePreviewContent({
        ...base,
        preview: undefined,
        error: tooLarge,
      }),
    ).toEqual({
      kind: "too-large",
      message: "This file is too large to preview.",
    });
    expect(
      resolveFilePreviewContent({
        ...base,
        preview: undefined,
        error: new Error("boom"),
      }),
    ).toEqual({ kind: "error", message: "boom" });
  });

  it("picks the text kind from the path / mime type", () => {
    expect(
      resolveFilePreviewContent({
        ...base,
        preview: textPreview("src/a.ts", "x"),
      }),
    ).toMatchObject({ kind: "text", textKind: "code" });
    expect(
      resolveFilePreviewContent({
        ...base,
        activePath: "README.md",
        preview: textPreview("README.md", "# hi"),
      }),
    ).toMatchObject({ kind: "text", textKind: "markdown" });
    expect(
      resolveFilePreviewContent({
        ...base,
        activePath: "data.csv",
        preview: textPreview("data.csv", "a,b"),
      }),
    ).toMatchObject({ kind: "text", textKind: "csv" });
    expect(
      resolveFilePreviewContent({
        ...base,
        activePath: "notes",
        preview: textPreview("notes", "x", "text/markdown"),
      }),
    ).toMatchObject({ textKind: "markdown" });
  });

  it("renders an empty text file as empty", () => {
    expect(
      resolveFilePreviewContent({
        ...base,
        preview: textPreview("src/a.ts", ""),
      }),
    ).toEqual({ kind: "empty" });
  });

  it("routes HTML to the WebView only when a raw URL exists", () => {
    const preview = textPreview("index.html", "<h1>hi</h1>", "text/html");
    expect(
      resolveFilePreviewContent({
        ...base,
        activePath: "index.html",
        preview,
        htmlRawUrl: "https://s/raw/index.html",
      }),
    ).toEqual({
      kind: "html",
      content: "<h1>hi</h1>",
      rawUrl: "https://s/raw/index.html",
    });
    expect(
      resolveFilePreviewContent({ ...base, activePath: "index.html", preview }),
    ).toMatchObject({ kind: "text", textKind: "code" });
  });

  it("passes images, videos and unsupported blobs through", () => {
    const image: FilePreview = {
      kind: "image",
      path: "a.png",
      url: "data:image/png;base64,AA",
      mimeType: "image/png",
    };
    expect(
      resolveFilePreviewContent({
        ...base,
        activePath: "a.png",
        preview: image,
      }),
    ).toEqual({ kind: "image", url: image.url, mimeType: "image/png" });
    const blob: FilePreview = {
      kind: "unsupported",
      path: "a.bin",
      url: "u",
      mimeType: "application/octet-stream",
    };
    expect(
      resolveFilePreviewContent({
        ...base,
        activePath: "a.bin",
        preview: blob,
      }),
    ).toEqual({ kind: "unsupported", mimeType: "application/octet-stream" });
  });
});

describe("truncateFilePreviewCode", () => {
  it("returns null when the file fits", () => {
    expect(
      truncateFilePreviewCode("a\nb\nc", { maxLines: 5, maxChars: 100 }),
    ).toBeNull();
  });

  it("cuts at a line boundary within the line budget", () => {
    const truncated = truncateFilePreviewCode("a\nb\nc\nd", {
      maxLines: 2,
      maxChars: 100,
    });
    expect(truncated).toEqual({
      contents: "a\nb",
      renderedLineCount: 2,
      totalLineCount: 4,
    });
  });

  it("cuts before the line that crosses the char budget (but always keeps one)", () => {
    const truncated = truncateFilePreviewCode("abc\ndefgh\nij", {
      maxLines: 10,
      maxChars: 6,
    });
    expect(truncated).toEqual({
      contents: "abc",
      renderedLineCount: 1,
      totalLineCount: 3,
    });
    const single = truncateFilePreviewCode("abcdefghij\nk", {
      maxLines: 10,
      maxChars: 4,
    });
    expect(single?.contents).toBe("abcdefghij");
  });
});

describe("splitPreviewLines", () => {
  it("does not add a phantom line for a trailing newline and handles CRLF", () => {
    expect(splitPreviewLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitPreviewLines("")).toEqual([]);
    expect(splitPreviewLines("\n")).toEqual([""]);
  });
});

describe("CSV", () => {
  it("parses quoted fields, escaped quotes and CRLF, stopping at the row cap", () => {
    const parsed = parseCsvRows('a,"b,c","d""e"\r\n1,2,3\n4,5,6\n', 2);
    expect(parsed.rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "3"],
    ]);
    expect(parsed.truncatedRows).toBe(true);
  });

  it("keeps a trailing unterminated row", () => {
    expect(parseCsvRows("a,b\n1,2", 10).rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reports the widest row as the column count", () => {
    expect(buildCsvPreviewData("a,b\n1,2,3\n").columnCount).toBe(3);
  });
});

describe("buildFileLineSelectionText", () => {
  const contents = "one\ntwo\n  three  \nfour";
  it("quotes `path:line` followed by the line", () => {
    expect(
      buildFileLineSelectionText({
        contents,
        path: "src/a.ts",
        range: { startLineNumber: 2, endLineNumber: 2 },
      }),
    ).toBe("src/a.ts:2\ntwo");
  });
  it("quotes a range and trims trailing whitespace only", () => {
    expect(
      buildFileLineSelectionText({
        contents,
        path: "a",
        range: { startLineNumber: 2, endLineNumber: 3 },
      }),
    ).toBe("a:2-3\ntwo\n  three");
  });
  it("returns null off the end of the file or for whitespace-only lines", () => {
    expect(
      buildFileLineSelectionText({
        contents,
        path: "a",
        range: { startLineNumber: 9, endLineNumber: 9 },
      }),
    ).toBeNull();
    expect(
      buildFileLineSelectionText({
        contents: "  \n",
        path: "a",
        range: { startLineNumber: 1, endLineNumber: 1 },
      }),
    ).toBeNull();
  });
  it("formats bare references", () => {
    expect(formatFileLineReference("a.ts", null)).toBe("a.ts");
    expect(
      formatFileLineReference("a.ts", { startLineNumber: 3, endLineNumber: 7 }),
    ).toBe("a.ts:3-7");
  });
});

describe("formatFileSize", () => {
  it("prints bytes, KB and MB", () => {
    expect(formatFileSize(12)).toBe("12 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(15 * 1024 * 1024)).toBe("15 MB");
  });
});
