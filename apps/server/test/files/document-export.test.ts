import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { withTestHarness } from "../helpers/test-app.js";
import {
  absolutizeHtmlUrls,
  buildPrintDocument,
  MAX_FILE_EXPORT_CONTENT_BYTES,
  stripNonContentHtml,
} from "../../src/services/files/document-export.js";

function postExport(body: unknown, headers: Record<string, string> = {}) {
  return [
    "/api/v1/files/export",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  ] as const;
}

describe("document export route", () => {
  it("returns a Word document with an attachment filename", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        ...postExport({
          content: "<h1>Report</h1><p>Hello world</p>",
          sourceKind: "html",
          format: "docx",
          filename: "reports/result.html",
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(response.headers.get("content-disposition")).toContain(
        'filename="result.docx"',
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
    });
  });

  it("renders a Markdown print document with a base href and absolutized assets", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        ...postExport({
          content: "# Title\n\n![chart](img/chart.png)",
          sourceKind: "markdown",
          format: "print",
          baseHref: "http://localhost:1234/api/v1/docs/report.md",
          filename: "report.md",
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("content-disposition")).toContain(
        'filename="report.html"',
      );
      const html = await response.text();
      expect(html).toContain("<h1>Title</h1>");
      expect(html).toContain(
        '<base href="http://localhost:1234/api/v1/docs/report.md">',
      );
      expect(html).toContain(
        'src="http://localhost:1234/api/v1/docs/img/chart.png"',
      );
      expect(html).toContain("size: A4 portrait");
      expect(html).toContain("window.print()");
    });
  });

  it("omits script and style source from the Word document", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        ...postExport({
          content:
            '<h1>Report</h1><canvas></canvas><script>const secret=1;fillRect()</script><style>.x{color:red}</style>',
          sourceKind: "html",
          format: "docx",
          filename: "report.html",
        }),
      );
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const zip = await JSZip.loadAsync(bytes);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      expect(documentXml).toContain("Report");
      expect(documentXml).not.toContain("secret");
      expect(documentXml).not.toContain("fillRect");
      expect(documentXml).not.toContain("color:red");
      const stylesXml =
        (await zip.file("word/styles.xml")?.async("string")) ?? "";
      expect(stylesXml).toContain("Arial");
    });
  });

  it("returns a capture document that extracts rendered charts", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        ...postExport({
          content:
            '<h1>Report</h1><canvas id="c"></canvas><script>draw()</script>',
          sourceKind: "html",
          format: "capture",
          filename: "chart.html",
        }),
      );
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('var MODE="capture"');
      expect(html).toContain("bb-document-export");
      expect(html).toContain("postMessage");
      expect(html).toContain("toDataURL");
      expect(html).toContain('<canvas id="c">');
    });
  });

  it("rejects oversized content with 413", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        ...postExport({
          content: "a".repeat(MAX_FILE_EXPORT_CONTENT_BYTES + 1),
          sourceKind: "html",
          format: "print",
        }),
      );
      expect(response.status).toBe(413);
    });
  });

  it("rejects unknown formats and privileged mutation hazards", async () => {
    await withTestHarness(async (harness) => {
      const unknownFormat = await harness.app.request(
        ...postExport({
          content: "<p>x</p>",
          sourceKind: "html",
          format: "pdf",
        }),
      );
      expect(unknownFormat.status).toBe(400);

      const hostile = await harness.app.request(
        ...postExport(
          { content: "<p>x</p>", sourceKind: "html", format: "print" },
          { origin: "https://evil.example" },
        ),
      );
      expect(hostile.status).toBe(403);

      const simple = await harness.app.request("/api/v1/files/export", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          content: "<p>x</p>",
          sourceKind: "html",
          format: "print",
        }),
      });
      expect(simple.status).toBe(415);
    });
  });
});

describe("document export helpers", () => {
  it("absolutizes url attributes without touching schemes or anchors", () => {
    expect(
      absolutizeHtmlUrls(
        '<a href="#top">t</a><img src="a.png"><img src="https://x/y.png"><img src="data:image/png;base64,AA">',
        "http://host/docs/report.html",
      ),
    ).toBe(
      '<a href="#top">t</a><img src="http://host/docs/a.png"><img src="https://x/y.png"><img src="data:image/png;base64,AA">',
    );
  });

  it("absolutizes every srcset candidate", () => {
    expect(
      absolutizeHtmlUrls(
        '<img srcset="small.png 1x, nested/large.png 2x">',
        "http://host/docs/report.html",
      ),
    ).toBe(
      '<img srcset="http://host/docs/small.png 1x, http://host/docs/nested/large.png 2x">',
    );
  });

  it("strips scripts, styles, and other non-content elements", () => {
    expect(
      stripNonContentHtml(
        '<html><head><style>.x{color:red}</style><title>T</title><meta charset="utf-8"><link rel="stylesheet" href="a.css"></head><body><!-- note --><h1>Hi</h1><canvas></canvas><script>const ctx=1;fillRect()</script><noscript>Enable JS</noscript><template><p>t</p></template></body></html>',
      ),
    ).toBe('<html><head></head><body><h1>Hi</h1><canvas></canvas></body></html>');
  });

  it("injects base and print script into a full document", () => {
    const result = buildPrintDocument(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>x</h1></body></html>',
      "http://host/docs/report.html",
    );
    expect(result).toContain(
      '<base href="http://host/docs/report.html">',
    );
    expect(result).toContain("<h1>x</h1>");
    expect(result.indexOf("<base")).toBeLessThan(result.indexOf("<h1>"));
    expect(result).toContain("window.print()");
  });
});
