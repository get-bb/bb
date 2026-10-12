import { describe, expect, it } from "vitest";
import {
  formatApplicationWindowTitle,
  shouldShowServerInWindowTitles,
} from "../src/window-title.js";

describe("window titles", () => {
  it.each([
    { serverIds: [], expected: false },
    { serverIds: ["builtin"], expected: false },
    { serverIds: ["builtin", "builtin", "builtin"], expected: false },
    { serverIds: ["builtin", "connect:studio"], expected: true },
    {
      serverIds: ["connect:studio", "custom:abc", "custom:abc"],
      expected: true,
    },
  ])(
    "names servers only when open windows use two or more servers: $serverIds",
    ({ serverIds, expected }) => {
      expect(shouldShowServerInWindowTitles(serverIds)).toBe(expected);
    },
  );

  it("appends the server name after an em dash and leaves the page title alone otherwise", () => {
    expect(
      formatApplicationWindowTitle({
        pageTitle: "Fix the build · bb",
        serverName: "studio.tailnet.ts.net:38886",
      }),
    ).toBe("Fix the build · bb — studio.tailnet.ts.net:38886");
    expect(
      formatApplicationWindowTitle({ pageTitle: "bb", serverName: null }),
    ).toBe("bb");
  });
});
