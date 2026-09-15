// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  fileBaseName,
  resolveExportBaseHref,
  runCaptureFrame,
  shouldCaptureRenderedHtml,
} from "./document-export";

afterEach(() => {
  for (const frame of document.querySelectorAll("iframe")) {
    frame.remove();
  }
});

describe("resolveExportBaseHref", () => {
  it("resolves a path-shaped file url against the app origin", () => {
    expect(
      resolveExportBaseHref("/api/v1/threads/thr_1/worktree/files/a.md"),
    ).toBe(
      `${window.location.origin}/api/v1/threads/thr_1/worktree/files/a.md`,
    );
  });

  it("keeps an absolute file url", () => {
    expect(
      resolveExportBaseHref("http://localhost:3000/api/v1/docs/a.html"),
    ).toBe("http://localhost:3000/api/v1/docs/a.html");
  });

  it("returns null for data, blob, query, and empty urls", () => {
    expect(resolveExportBaseHref("data:text/html,hi")).toBeNull();
    expect(resolveExportBaseHref("blob:http://localhost/abc")).toBeNull();
    expect(resolveExportBaseHref("/api/v1/files/content?path=a.md")).toBeNull();
    expect(resolveExportBaseHref(null)).toBeNull();
    expect(resolveExportBaseHref("")).toBeNull();
  });
});

describe("fileBaseName", () => {
  it("strips directories and the extension", () => {
    expect(fileBaseName("reports/quarterly.md")).toBe("quarterly");
  });

  it("handles backslash paths and extensionless names", () => {
    expect(fileBaseName("reports\\chart.html")).toBe("chart");
    expect(fileBaseName("README")).toBe("README");
  });
});

describe("shouldCaptureRenderedHtml", () => {
  it("captures HTML with rendered canvases or scripts", () => {
    expect(shouldCaptureRenderedHtml("html", '<canvas id="c">')).toBe(true);
    expect(shouldCaptureRenderedHtml("html", "<svg></svg>")).toBe(true);
    expect(shouldCaptureRenderedHtml("html", "<script>draw()</script>")).toBe(
      true,
    );
  });

  it("skips static HTML and Markdown", () => {
    expect(shouldCaptureRenderedHtml("html", "<p>static</p>")).toBe(false);
    expect(shouldCaptureRenderedHtml("markdown", "<canvas>")).toBe(false);
  });
});

describe("runCaptureFrame", () => {
  it("resolves with the captured HTML posted from the sandboxed frame", async () => {
    const pending = runCaptureFrame("<html>capture</html>");
    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          channel: "bb-document-export",
          ok: true,
          html: "<html>captured</html>",
        },
        source: frame?.contentWindow ?? null,
      }),
    );
    await expect(pending).resolves.toBe("<html>captured</html>");
  });

  it("rejects with the error posted from the frame", async () => {
    const pending = runCaptureFrame("<html>capture</html>");
    const frame = document.querySelector("iframe");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: "bb-document-export", ok: false, error: "boom" },
        source: frame?.contentWindow ?? null,
      }),
    );
    await expect(pending).rejects.toThrow("boom");
  });
});
