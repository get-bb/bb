import { describe, expect, it } from "vitest";
import {
  RETIRED_PLUGIN_SUCCESSORS,
  pathWithRetiredPluginIdsReplaced,
} from "../src/plugin-id.js";

describe("pathWithRetiredPluginIdsReplaced", () => {
  it.each([
    [
      "/settings/plugins/bb--provider-acp-next",
      "/settings/plugins/provider-acp",
    ],
    ["/plugins/bb--provider-acp-next", "/plugins/provider-acp"],
    [
      "/extensions/plugins/bb--provider-acp-next/settings",
      "/extensions/plugins/provider-acp/settings",
    ],
  ])("rewrites %s", (pathname, expected) => {
    expect(pathWithRetiredPluginIdsReplaced(pathname)).toBe(expected);
  });

  it.each([
    "/settings/plugins/provider-acp",
    "/settings/plugins/bb--provider-acp-next-extra",
    "/threads/bb",
    "/settings/plugins/constructor",
  ])("leaves %s alone", (pathname) => {
    expect(pathWithRetiredPluginIdsReplaced(pathname)).toBeNull();
  });

  it("maps every retired plugin to a different plugin", () => {
    for (const [retired, successor] of Object.entries(
      RETIRED_PLUGIN_SUCCESSORS,
    )) {
      expect(successor).not.toBe(retired);
      expect(Object.hasOwn(RETIRED_PLUGIN_SUCCESSORS, successor)).toBe(false);
    }
  });
});
