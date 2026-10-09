import { describe, expect, it } from "vitest";
import { appHtml, appResourceUri, APP_MIME_TYPE } from "./protocol.js";

describe("MCP App resource extraction", () => {
  it("recognizes declared UI tools and preserves text fallback for others", () => {
    expect(appResourceUri({
      name: "edit",
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: "ui://edit/view" } },
    })).toBe("ui://edit/view");
    expect(appResourceUri({ name: "plain", inputSchema: { type: "object" } })).toBeNull();
  });

  it("requires the MCP App MIME type and exact resource URI", () => {
    expect(appHtml([{ uri: "ui://edit/view", mimeType: APP_MIME_TYPE, text: "<p>ok</p>" }], "ui://edit/view")).toBe("<p>ok</p>");
    expect(() => appHtml([{ uri: "ui://other", mimeType: APP_MIME_TYPE, text: "<p>wrong</p>" }], "ui://edit/view")).toThrow();
    expect(() => appHtml([{ uri: "ui://edit/view", mimeType: "text/html", text: "<p>wrong</p>" }], "ui://edit/view")).toThrow();
  });
});
