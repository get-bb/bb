// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTypstPrintHtml,
  downloadBlob,
  printHtmlDocument,
  typstDocumentBaseName,
} from "./typst-export";
import { splitTypstPages } from "./typst-pages";
import { TWO_PAGE_SVG } from "./typst-svg.fixture";

function mockDownloadEnvironment(): { clicks: string[]; restore: () => void } {
  const clicks: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = () => "blob:typst-export";
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicks.push(this.download);
  };
  return {
    clicks,
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("typstDocumentBaseName", () => {
  it("strips directories and the extension", () => {
    expect(typstDocumentBaseName("reports/report.typ")).toBe("report");
    expect(typstDocumentBaseName("a/b.c.typ")).toBe("b.c");
    expect(typstDocumentBaseName("report")).toBe("report");
  });
});

describe("buildTypstPrintHtml", () => {
  it("prints one sheet per page at the page size", () => {
    const pages = splitTypstPages(TWO_PAGE_SVG);
    const html = buildTypstPrintHtml(pages, "reports/report.typ");

    expect(html).toContain("@page { size: 200pt 100pt; margin: 0; }");
    expect(html.match(/<section class="typst-page">/g)).toHaveLength(2);
    expect(html).toContain("break-after: page");
    expect(html).toContain("window.print()");
  });

  it("escapes the document title", () => {
    const pages = splitTypstPages(TWO_PAGE_SVG);
    const html = buildTypstPrintHtml(pages, '<img src="x">.typ');

    expect(html).toContain("<title>&lt;img src=&quot;x&quot;&gt;.typ</title>");
    expect(html).not.toContain('<img src="x">');
  });

  it("rejects an empty page list", () => {
    expect(() => buildTypstPrintHtml([], "report.typ")).toThrow(/no pages/);
  });
});

describe("downloadBlob", () => {
  it("click-downloads the blob and revokes the object url", () => {
    const downloads = mockDownloadEnvironment();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      downloadBlob(new Blob(["pdf"], { type: "application/pdf" }), "report.pdf");
      expect(downloads.clicks).toEqual(["report.pdf"]);
    } finally {
      downloads.restore();
      revoke.mockRestore();
    }
  });
});

describe("printHtmlDocument", () => {
  it("prints inside a script-enabled sandboxed frame", () => {
    printHtmlDocument("<html><body>page</body></html>");

    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("sandbox")).toBe("allow-scripts allow-modals");
    expect(frame!.getAttribute("srcdoc")).toContain("<body>page</body>");
  });
});
