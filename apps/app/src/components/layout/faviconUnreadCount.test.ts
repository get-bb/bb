import { describe, expect, it } from "vitest";
import { getFaviconUnreadCount } from "./faviconUnreadCount";

type FaviconSidebarThread = Parameters<
  typeof getFaviconUnreadCount
>[0]["sidebarThreads"][number];

function makeSidebarThread(
  overrides: Partial<FaviconSidebarThread> = {},
): FaviconSidebarThread {
  return {
    originKind: null,
    childOrigin: null,
    lastReadAt: 10,
    latestAttentionAt: 20,
    ...overrides,
  };
}

describe("getFaviconUnreadCount", () => {
  it("ignores unread side-chat threads hidden from the sidebar", () => {
    expect(
      getFaviconUnreadCount({
        isThreadView: false,
        thread: null,
        sidebarThreads: [
          makeSidebarThread({ originKind: "side-chat" }),
          makeSidebarThread({ childOrigin: "side-chat" }),
        ],
      }),
    ).toBe(0);
  });

  it("counts visible unread sidebar threads", () => {
    expect(
      getFaviconUnreadCount({
        isThreadView: false,
        thread: null,
        sidebarThreads: [
          makeSidebarThread(),
          makeSidebarThread({ lastReadAt: 30 }),
          makeSidebarThread({ originKind: "side-chat" }),
        ],
      }),
    ).toBe(1);
  });

  it("uses only the current thread while viewing a thread", () => {
    expect(
      getFaviconUnreadCount({
        isThreadView: true,
        thread: { lastReadAt: 10, latestAttentionAt: 20 },
        sidebarThreads: [],
      }),
    ).toBe(1);
  });
});
