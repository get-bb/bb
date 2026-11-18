import { describe, expect, it } from "vitest";
import { finalizeDocumentResponse } from "./document-response";

function renderedPage(headers: Record<string, string>): Response {
  return new Response("<!doctype html><title>bb account</title>", {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

describe("finalizeDocumentResponse", () => {
  it("forbids framing every rendered page, including ones with no other override", async () => {
    const response = finalizeDocumentResponse(renderedPage({}), {
      status: null,
      cacheControl: null,
    });

    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(await response.text()).toBe(
      "<!doctype html><title>bb account</title>",
    );
  });

  it("keeps a route's own policy and headers while applying status and cache overrides", () => {
    const response = finalizeDocumentResponse(
      renderedPage({
        "content-security-policy": "script-src 'self'",
        "x-robots-tag": "noindex, nofollow",
      }),
      { status: 503, cacheControl: "no-store" },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-security-policy")).toBe(
      "script-src 'self', frame-ancestors 'none'",
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
