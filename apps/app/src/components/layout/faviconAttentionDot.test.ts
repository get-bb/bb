import { describe, expect, it } from "vitest";
import { shouldShowFaviconAttentionDot } from "./faviconAttentionDot";

type FaviconSidebarThread = Parameters<
  typeof shouldShowFaviconAttentionDot
>[0]["sidebarThreads"][number];

function makeSidebarThread(
  overrides: Partial<FaviconSidebarThread> = {},
): FaviconSidebarThread {
  return {
    originKind: null,
    childOrigin: null,
    hasPendingInteraction: false,
    lastReadAt: 10,
    latestAttentionAt: 20,
    ...overrides,
  };
}

const BASE_ARGS = {
  currentThreadHasPendingInteraction: false,
  isThreadView: false,
  thread: null,
  sidebarThreads: [] as FaviconSidebarThread[],
};

describe("shouldShowFaviconAttentionDot", () => {
  it("ignores unread side-chat threads hidden from the sidebar", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [
          makeSidebarThread({ originKind: "side-chat" }),
          makeSidebarThread({ childOrigin: "side-chat" }),
        ],
      }),
    ).toBe(false);
  });

  it("shows the dot for a visible unread sidebar thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [
          makeSidebarThread(),
          makeSidebarThread({ lastReadAt: 30 }),
          makeSidebarThread({ originKind: "side-chat" }),
        ],
      }),
    ).toBe(true);
  });

  it("uses only the current thread's unread state while viewing a thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        thread: { lastReadAt: 10, latestAttentionAt: 20 },
        sidebarThreads: [],
      }),
    ).toBe(true);
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [makeSidebarThread({ lastReadAt: 5 })],
      }),
    ).toBe(false);
  });

  it("shows the dot when a background thread is waiting on user input, even when read and out of view", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        // Viewing an unrelated, already-read thread...
        isThreadView: true,
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        // ...while a read background thread is blocked on the user.
        sidebarThreads: [
          makeSidebarThread({
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("shows the dot when the in-view thread is blocked on input but absent from the sidebar (archived/side-chat)", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        // Already read, and not represented in the sidebar list.
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [],
        currentThreadHasPendingInteraction: true,
      }),
    ).toBe(true);
  });

  it("ignores the in-view pending flag when not viewing a thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: false,
        currentThreadHasPendingInteraction: true,
        sidebarThreads: [makeSidebarThread({ lastReadAt: 30 })],
      }),
    ).toBe(false);
  });

  it("ignores pending interactions on background side-chat threads", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [
          makeSidebarThread({
            originKind: "side-chat",
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(false);
  });
});
