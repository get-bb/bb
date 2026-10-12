import { describe, expect, it } from "vitest";
import { normalizePluginAppRoute } from "./plugin-app-route";

const ORIGIN = "http://127.0.0.1:38886";

describe("normalizePluginAppRoute", () => {
  it.each([
    ["/settings/mobile", "/settings/mobile"],
    ["/settings/updates#whats-new", "/settings/updates#whats-new"],
    [
      "/settings/plugins/bb--provider-usage?view=installed",
      "/settings/plugins/bb--provider-usage?view=installed",
    ],
    ["/settings/../extensions", "/extensions"],
  ])("keeps the in-app route %s", (path, expected) => {
    expect(normalizePluginAppRoute(path, ORIGIN)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://example.com/settings"],
    ["a protocol-relative URL", "//example.com/settings"],
    ["a relative path", "settings/mobile"],
    ["a backslash path", "/\\example.com"],
    ["a control character", "/settings\n/mobile"],
    ["a javascript URL", "javascript:alert(1)"],
    ["an API route", "/api/v1/system/config"],
    ["the API root", "/api"],
    ["an API route reached by traversal", "/settings/../api/v1/threads"],
    ["an empty string", ""],
    ["a non-string", 42],
  ])("rejects %s", (_label, path) => {
    expect(normalizePluginAppRoute(path, ORIGIN)).toBeNull();
  });
});
