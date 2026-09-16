// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSourceBaseHref, requestMarkdownDocx } from "./docx-export";

describe("buildSourceBaseHref", () => {
  it("uses the worktree route for workspace files", () => {
    expect(
      buildSourceBaseHref({
        threadId: "thr_1",
        file: "reports/my report.md",
        sourceKind: "workspace",
      }),
    ).toContain(
      "/api/v1/threads/thr_1/worktree/files/reports/my%20report.md",
    );
  });

  it("uses the thread-storage route for storage files", () => {
    expect(
      buildSourceBaseHref({
        threadId: "thr_1",
        file: "reports/result.md",
        sourceKind: "thread-storage",
      }),
    ).toContain(
      "/api/v1/threads/thr_1/thread-storage/files/reports/result.md",
    );
  });
});

describe("requestMarkdownDocx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the Markdown to the core export route", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["docx"], { type: "application/vnd.ms-word" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await requestMarkdownDocx({
      baseHref: "https://bb.test/notes.md",
      content: "# Notes",
      fileName: "reports/notes.md",
    });

    expect(blob).toBeInstanceOf(Blob);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/files/export");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      baseHref: "https://bb.test/notes.md",
      content: "# Notes",
      filename: "reports/notes.md",
      format: "docx",
      sourceKind: "markdown",
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
      requestMarkdownDocx({
        baseHref: "https://bb.test/notes.md",
        content: "# Notes",
        fileName: "notes.md",
      }),
    ).rejects.toThrow("conversion failed");
  });
});
