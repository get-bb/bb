// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  UNAVAILABLE_APP_PANEL_CONTROLLER,
  getThreadFixedTabOwnerId,
} from "@/lib/app-fixed-tab-navigation";
import {
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
} from "@/lib/side-chat-plugin";
import { useThreadTimelineTitleActions } from "./thread-screen-hosts";

function resolveSideChat(panelAccepts: boolean) {
  const openTab = vi.fn(() => panelAccepts);
  const openThread = vi.fn();
  const { result } = renderHook(() =>
    useThreadTimelineTitleActions({
      threadId: "thr_main",
      projectId: "proj_main",
      environmentId: null,
      panel: { ...UNAVAILABLE_APP_PANEL_CONTROLLER, openTab },
      openFilePreview: () => false,
      openLocalFileLink: () => false,
      openThread,
    }),
  );
  result.current({ kind: "open-plugin-side-chat", threadId: "thr_side" })?.();
  return { openTab, openThread };
}

describe("useThreadTimelineTitleActions side chat titles", () => {
  it("opens the side chat in the surface's panel when the panel hosts it", () => {
    const { openTab, openThread } = resolveSideChat(true);
    expect(openTab).toHaveBeenCalledWith({
      tab: {
        ownerId: getThreadFixedTabOwnerId(SIDE_CHAT_PLUGIN_ID),
        tabId: SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
      },
      availability: "action",
      params: { threadId: "thr_side", sourceThreadId: "thr_main" },
    });
    expect(openThread).not.toHaveBeenCalled();
  });

  it("opens the side chat thread when the surface's panel cannot host it", () => {
    const { openThread } = resolveSideChat(false);
    expect(openThread).toHaveBeenCalledWith({
      projectId: "proj_main",
      threadId: "thr_side",
    });
  });
});
