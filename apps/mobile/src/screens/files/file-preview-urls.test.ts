import { describe, expect, it } from "vitest";
import {
  buildFileTargetExternalUrl,
  buildFileTargetHtmlUrl,
  type FileTargetUrlContext,
} from "./file-preview-urls";

const context: FileTargetUrlContext = {
  serverUrl: "https://bb.example/",
  threadId: "thread-1",
  projectId: "project-1",
  environmentId: null,
  hostId: null,
};

describe("buildFileTargetHtmlUrl", () => {
  it("routes host files through the CSP-sandboxed raw filesystem route", () => {
    expect(
      buildFileTargetHtmlUrl(context, {
        kind: "host-file",
        path: "/tmp/report.html",
      }),
    ).toBe(
      "https://bb.example/api/v1/threads/thread-1/files/raw?path=%2Ftmp%2Freport.html",
    );
  });

  it("never renders project files: /projects/:id/files/content has no sandbox CSP", () => {
    const target = { kind: "project-file", path: "report.html" } as const;
    // The bytes are still reachable for "Open in browser"...
    expect(buildFileTargetExternalUrl(context, target)).toBe(
      "https://bb.example/api/v1/projects/project-1/files/content?path=report.html",
    );
    // ...but the WebView must not load them; the preview falls back to source.
    expect(buildFileTargetHtmlUrl(context, target)).toBeNull();
  });

  it("uses the sandboxed storage raw route for storage files", () => {
    expect(
      buildFileTargetHtmlUrl(context, {
        kind: "storage-file",
        path: "out/index.html",
      }),
    ).toBe(
      "https://bb.example/api/v1/threads/thread-1/thread-storage/files/out/index.html",
    );
  });

  it("returns null outside a thread for host and storage files", () => {
    const noThread = { ...context, threadId: null };
    expect(
      buildFileTargetHtmlUrl(noThread, { kind: "host-file", path: "/a.html" }),
    ).toBeNull();
    expect(
      buildFileTargetHtmlUrl(noThread, {
        kind: "storage-file",
        path: "a.html",
      }),
    ).toBeNull();
  });
});
