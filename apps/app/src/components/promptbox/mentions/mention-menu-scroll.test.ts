import { describe, expect, it } from "vitest";
import { shouldLoadMoreCommandResults } from "./mention-menu-scroll";

describe("shouldLoadMoreCommandResults", () => {
  it("loads another command page near the scroll bottom", () => {
    expect(
      shouldLoadMoreCommandResults({
        trigger: "command",
        hasLoadMoreCallback: true,
        scrollHeight: 500,
        scrollTop: 252,
        clientHeight: 200,
      }),
    ).toBe(true);
  });

  it("does not load while the command list is not near the bottom", () => {
    expect(
      shouldLoadMoreCommandResults({
        trigger: "command",
        hasLoadMoreCallback: true,
        scrollHeight: 500,
        scrollTop: 200,
        clientHeight: 200,
      }),
    ).toBe(false);
  });

  it("does not load for mention menus", () => {
    expect(
      shouldLoadMoreCommandResults({
        trigger: "mention",
        hasLoadMoreCallback: true,
        scrollHeight: 500,
        scrollTop: 252,
        clientHeight: 200,
      }),
    ).toBe(false);
  });

  it("does not load when no command pager is available", () => {
    expect(
      shouldLoadMoreCommandResults({
        trigger: "command",
        hasLoadMoreCallback: false,
        scrollHeight: 500,
        scrollTop: 252,
        clientHeight: 200,
      }),
    ).toBe(false);
  });
});
