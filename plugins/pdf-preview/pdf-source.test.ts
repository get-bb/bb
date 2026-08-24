import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPdfBlob, resolvePdfReadTarget } from "./pdf-source.js";

const ids = {
  threadId: "thr_1",
  environmentId: "env_1",
  projectId: "proj_1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolvePdfReadTarget", () => {
  it.each([
    {
      source: { kind: "workspace" as const, ...ids },
      path: "docs/a report.pdf",
      expected: "/api/v1/threads/thr_1/worktree/files/docs/a%20report.pdf",
      kind: "raw",
    },
    {
      source: { kind: "host" as const, ...ids },
      path: "/tmp/a report.pdf",
      expected:
        "/api/v1/threads/thr_1/host-files/content?path=%2Ftmp%2Fa+report.pdf",
      kind: "raw",
    },
    {
      source: { kind: "thread-storage" as const, ...ids },
      path: "exports/a report.pdf",
      expected:
        "/api/v1/threads/thr_1/thread-storage/files/exports/a%20report.pdf",
      kind: "raw",
    },
  ])("uses the raw $source.kind route", ({ source, path, expected, kind }) => {
    expect(resolvePdfReadTarget(path, source)).toEqual({ kind, url: expected });
  });

  it("uses the workspace JSON route when no thread owns the environment", () => {
    expect(
      resolvePdfReadTarget("docs/handbook.pdf", {
        kind: "workspace",
        threadId: null,
        environmentId: "env_1",
        projectId: null,
      }),
    ).toEqual({
      kind: "workspace-json",
      url: "/api/v1/environments/env_1/diff/file?target=uncommitted&path=docs%2Fhandbook.pdf&side=new",
    });
  });

  it("uses the project content route for a project-backed compose preview", () => {
    expect(
      resolvePdfReadTarget("docs/handbook.pdf", {
        kind: "workspace",
        threadId: null,
        environmentId: null,
        projectId: "proj_1",
        experimental_hostId: "host_remote",
      }),
    ).toEqual({
      kind: "raw",
      url: "/api/v1/projects/proj_1/files/content?path=docs%2Fhandbook.pdf&hostId=host_remote",
    });
  });
});

describe("loadPdfBlob", () => {
  it("decodes the environment JSON route into a PDF-typed blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: "JVBERg==",
            contentEncoding: "base64",
            mimeType: "application/pdf",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const blob = await loadPdfBlob(
      { kind: "workspace-json", url: "/environment-file" },
      new AbortController().signal,
    );

    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
  });
});
