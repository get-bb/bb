import { describe, expect, it } from "vitest";
import {
  areEnvironmentFilePreviewSourcesEqual,
  buildFilePreview,
  isMarkdownFilePreview,
  normalizeFilePreviewMimeType,
} from "./file-preview";

describe("file-preview", () => {
  it("builds text previews from declared text mime types or detected UTF-8 content", () => {
    const declaredTextPreview = buildFilePreview({
      contentBytes: new TextEncoder().encode("export const value = 1;\n"),
      mimeType: "text/plain",
      name: "notes.txt",
      path: "notes.txt",
      url: "/files/notes.txt",
    });
    const detectedUtf8Preview = buildFilePreview({
      contentBytes: new TextEncoder().encode('{"ok":true}\n'),
      mimeType: "application/octet-stream",
      path: "result.log",
      url: "/files/result.log",
    });

    expect(declaredTextPreview).toEqual({
      kind: "text",
      mimeType: "text/plain",
      name: "notes.txt",
      path: "notes.txt",
      url: "/files/notes.txt",
      content: "export const value = 1;\n",
    });
    expect(detectedUtf8Preview).toEqual({
      kind: "text",
      mimeType: "application/octet-stream",
      path: "result.log",
      url: "/files/result.log",
      content: '{"ok":true}\n',
    });
  });

  it("builds image previews for image mime types", () => {
    const preview = buildFilePreview({
      contentBytes: Uint8Array.from([137, 80, 78, 71]),
      mimeType: "image/png",
      name: "diagram.png",
      path: "diagram.png",
      url: "/files/diagram.png",
    });

    expect(preview).toEqual({
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      path: "diagram.png",
      url: "/files/diagram.png",
    });
  });

  it("builds video previews for video mime types", () => {
    const preview = buildFilePreview({
      contentBytes: Uint8Array.from([0, 0, 0, 24]),
      mimeType: "video/mp4",
      name: "demo.mp4",
      path: "demo.mp4",
      url: "/files/demo.mp4",
    });

    expect(preview).toEqual({
      kind: "video",
      mimeType: "video/mp4",
      name: "demo.mp4",
      path: "demo.mp4",
      url: "/files/demo.mp4",
    });
  });

  it("prefers UTF-8 text over ambiguous video mime types", () => {
    const preview = buildFilePreview({
      contentBytes: new TextEncoder().encode("export const value = 1;\n"),
      mimeType: "video/mp2t",
      name: "commands.ts",
      path: "apps/server/test/helpers/commands.ts",
      url: "/files/commands.ts",
    });

    expect(preview).toEqual({
      kind: "text",
      mimeType: "video/mp2t",
      name: "commands.ts",
      path: "apps/server/test/helpers/commands.ts",
      url: "/files/commands.ts",
      content: "export const value = 1;\n",
    });
  });

  it("marks null-byte text and non-text binary files as unsupported", () => {
    const textWithNullBytePreview = buildFilePreview({
      contentBytes: Uint8Array.from([97, 0, 98]),
      mimeType: "text/plain",
      path: "broken.txt",
      url: "/files/broken.txt",
    });
    const binaryPreview = buildFilePreview({
      contentBytes: Uint8Array.from([0, 1, 2, 3]),
      mimeType: "application/octet-stream",
      path: "archive.bin",
      url: "/files/archive.bin",
    });

    expect(textWithNullBytePreview).toEqual({
      kind: "unsupported",
      mimeType: "text/plain",
      path: "broken.txt",
      url: "/files/broken.txt",
    });
    expect(binaryPreview).toEqual({
      kind: "unsupported",
      mimeType: "application/octet-stream",
      path: "archive.bin",
      url: "/files/archive.bin",
    });
  });

  it("normalizes file preview mime types", () => {
    expect(normalizeFilePreviewMimeType("text/plain; charset=utf-8")).toBe(
      "text/plain",
    );
    expect(normalizeFilePreviewMimeType(null)).toBe("application/octet-stream");
  });

  it("compares environment file preview sources structurally", () => {
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "working-tree" },
        { kind: "working-tree" },
      ),
    ).toBe(true);
    expect(
      areEnvironmentFilePreviewSourcesEqual({ kind: "head" }, { kind: "head" }),
    ).toBe(true);
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "merge-base", ref: "abc1234" },
        { kind: "merge-base", ref: "abc1234" },
      ),
    ).toBe(true);
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "merge-base", ref: "abc1234" },
        { kind: "merge-base", ref: "def5678" },
      ),
    ).toBe(false);
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "working-tree" },
        { kind: "head" },
      ),
    ).toBe(false);
  });

  it("detects Markdown text previews by extension and mime type", () => {
    const markdownByPath = buildFilePreview({
      contentBytes: new TextEncoder().encode("# Notes\n"),
      mimeType: "text/plain",
      path: "docs/notes.md",
      url: "/files/docs/notes.md",
    });
    const markdownByMime = buildFilePreview({
      contentBytes: new TextEncoder().encode("# Notes\n"),
      mimeType: "text/markdown",
      path: "docs/notes",
      url: "/files/docs/notes",
    });
    const plainText = buildFilePreview({
      contentBytes: new TextEncoder().encode("# Notes\n"),
      mimeType: "text/plain",
      path: "docs/notes.txt",
      url: "/files/docs/notes.txt",
    });

    expect(isMarkdownFilePreview(markdownByPath)).toBe(true);
    expect(isMarkdownFilePreview(markdownByMime)).toBe(true);
    expect(isMarkdownFilePreview(plainText)).toBe(false);
  });
});
