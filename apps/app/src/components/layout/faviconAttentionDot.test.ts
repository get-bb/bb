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
    hasPendingInteraction: false,
    lastReadAt: 10,
    latestAttentionAt: 20,
    visibility: "visible",
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
        sidebarThreads: [makeSidebarThread({ visibility: "hidden" })],
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
          makeSidebarThread({ visibility: "hidden" }),
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

  it("ignores background attention while a focused thread owns the favicon", () => {
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
    ).toBe(false);
  });

  it("shows background pending attention when no thread is focused", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
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
            visibility: "hidden",
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(false);
  });
});
