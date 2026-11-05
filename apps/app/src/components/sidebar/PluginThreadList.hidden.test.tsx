// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import {
  resetThreadActionRegistryForTest,
  ThreadActionCollectors,
  ThreadActionSurfaceVisibility,
} from "@/lib/thread-actions/thread-action-registry";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  loadPluginThreadListReplacement,
  seedSidebarQueryClient,
  SidebarThreadListHarness,
  stubPluginRpcFetch,
} from "@/test/fixtures/sidebar-thread-list";
import { PluginThreadList } from "./PluginThreadList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetThreadActionRegistryForTest();
});

class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

it("a hidden plugin thread list mounts no rows and subscribes no thread ids", async () => {
  resetThreadActionRegistryForTest();
  stubPluginRpcFetch((method) => ({
    result: method === "listPreferences" ? { preferences: {} } : null,
  }));
  vi.stubGlobal("IntersectionObserver", InertObserver);
  vi.stubGlobal("ResizeObserver", InertObserver);
  const replacement = await loadPluginThreadListReplacement({
    withNotifications: false,
  });
  const seen: (readonly string[])[] = [];
  setPluginSlotRegistrations(
    "recorder",
    makePluginRegistrationSet({
      threadActions: [
        {
          id: "recorder",
          title: "Recorder",
          icon: "Notification",
          group: "9_test",
          useData: ({ threadIds }) => {
            if (seen.at(-1) !== threadIds) seen.push(threadIds);
            return null;
          },
          item: () => null,
        },
      ],
    }),
  );
  const rendered = render(
    <SidebarThreadListHarness queryClient={seedSidebarQueryClient(250)}>
      <ThreadActionCollectors
        coreRegistrations={CORE_THREAD_ACTIONS}
        requestRename={() => {}}
      />
      <ThreadActionSurfaceVisibility visible={false}>
        <PluginThreadList replacement={replacement} onNavigate={() => {}} />
      </ThreadActionSurfaceVisibility>
    </SidebarThreadListHarness>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  expect(
    rendered.container.querySelectorAll("[data-sidebar-windowed-item]").length,
  ).toBeGreaterThan(100);
  expect(
    rendered.container.querySelectorAll("[data-sidebar-thread-id]"),
  ).toHaveLength(0);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((ids) => ids.length === 0)).toBe(true);
});
