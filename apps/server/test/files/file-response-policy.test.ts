import { describe, expect, it } from "vitest";
import {
  buildFileContentDisposition,
  buildFileResponseHeaders,
  sanitizeFileResponseName,
} from "../../src/services/files/file-response-policy.js";

describe("file response policy", () => {
  it.each([
    ["text/plain", "text/plain"],
    ["text/markdown", "text/markdown"],
    ["text/csv", "text/csv"],
    ["text/html", "text/html; charset=utf-8"],
    ["application/pdf", "application/pdf"],
    ["image/svg+xml", "image/svg+xml"],
    ["image/png", "image/png"],
    ["audio/ogg", "audio/ogg"],
    ["video/mp4", "video/mp4"],
    ["application/x-unknown", "application/octet-stream"],
  ])("normalizes %s preview responses to %s", (mimeType, expected) => {
    const headers = buildFileResponseHeaders({
      disposition: "inline",
      fileName: "fixture.bin",
      mimeType,
    });
    expect(headers.get("content-type")).toBe(expected);
    expect(headers.get("content-disposition")).toContain("inline;");
  });

  it("builds safe inline headers for passive and active preview types", () => {
    const pdf = buildFileResponseHeaders({
      disposition: "inline",
      fileName: "résumé 100%.pdf",
      mimeType: "application/pdf",
    });
    expect(pdf.get("content-type")).toBe("application/pdf");
    expect(pdf.get("content-disposition")).toContain("inline;");
    expect(pdf.get("content-disposition")).toContain(
      "filename*=UTF-8''r%C3%A9sum%C3%A9%20100%25.pdf",
    );
    expect(pdf.get("x-content-type-options")).toBe("nosniff");

    const html = buildFileResponseHeaders({
      disposition: "inline",
      fileName: "report.html",
      mimeType: "text/html; charset=utf-8",
    });
    expect(html.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.get("content-security-policy")).toBe("sandbox allow-scripts");
  });

  it.each([
    ["text/html", "text/html; charset=utf-8"],
    ["application/xhtml+xml", "application/xhtml+xml"],
    ["application/rdf+xml", "application/rdf+xml"],
    ["application/xml", "application/xml"],
    ["text/xml", "text/xml"],
    ["text/mathml", "text/mathml"],
    ["image/svg+xml", "image/svg+xml"],
  ])(
    "sandboxes %s previews without changing their safe MIME type",
    (mimeType, expectedContentType) => {
      const preview = buildFileResponseHeaders({
        disposition: "inline",
        fileName: "active-content.xml",
        mimeType,
      });
      const download = buildFileResponseHeaders({
        disposition: "attachment",
        fileName: "active-content.xml",
        mimeType,
      });

      expect(preview.get("content-type")).toBe(expectedContentType);
      expect(preview.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(download.get("content-security-policy")).toBeNull();
    },
  );

  it("forces unknown preview types to octet-stream and preserves download MIME", () => {
    expect(
      buildFileResponseHeaders({
        disposition: "inline",
        fileName: "payload.bin",
        mimeType: "application/x-custom-binary",
      }).get("content-type"),
    ).toBe("application/octet-stream");
    expect(
      buildFileResponseHeaders({
        disposition: "attachment",
        fileName: "payload.bin",
        mimeType: "application/x-custom-binary",
      }).get("content-type"),
    ).toBe("application/x-custom-binary");
  });

  it("sanitizes path syntax, controls, bidi markers, and empty names", () => {
    expect(sanitizeFileResponseName("../folder\\bad\u202E:name?.txt")).toBe(
      "bad_name_.txt",
    );
    expect(sanitizeFileResponseName("..")).toBe("download");
    expect(buildFileContentDisposition("attachment", "图 %.csv")).toBe(
      "attachment; filename=\"- %.csv\"; filename*=UTF-8''%E5%9B%BE%20%25.csv",
    );
  });
});
