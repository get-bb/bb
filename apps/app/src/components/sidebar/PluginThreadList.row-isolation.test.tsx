// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionForm } from "@bb/shared-ui/question-form";
import {
  ThreadTitleMentionResourcesProvider,
  useSidebarThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { patchThreadEntity } from "@/hooks/cache-owners/thread-entity-store";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import {
  resetThreadActionRegistryForTest,
  ThreadActionCollectors,
} from "@/lib/thread-actions/thread-action-registry";
import {
  loadPluginThreadListReplacement,
  seedSidebarQueryClient,
  SidebarThreadListHarness,
  stubPluginRpcFetch,
} from "@/test/fixtures/sidebar-thread-list";
import { SidebarThreadListContent } from "./PluginThreadList";

const renderedRows = vi.hoisted(() => new Set<string>());

vi.mock("@/lib/plugin-thread-row-status", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/plugin-thread-row-status")>();
  return {
    ...original,
    usePluginThreadRowStatus: (threadId: string) => {
      renderedRows.add(threadId);
      return original.usePluginThreadRowStatus(threadId);
    },
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetThreadActionRegistryForTest();
  window.localStorage.clear();
});

function AppTitleMentionResources({ children }: { children: ReactNode }) {
  const { data } = useSidebarNavigation();
  const resources = useSidebarThreadTitleMentionResources(data);
  return (
    <ThreadTitleMentionResourcesProvider {...resources}>
      {children}
    </ThreadTitleMentionResourcesProvider>
  );
}

function prepareThreadList() {
  resetThreadActionRegistryForTest();
  stubPluginRpcFetch((method) => ({
    result: method === "listPreferences" ? { preferences: {} } : null,
  }));
  vi.stubGlobal("IntersectionObserver", undefined);
  return seedSidebarQueryClient(60);
}

const replacement = await loadPluginThreadListReplacement({
  withNotifications: false,
});

function ThreadList() {
  return (
    <AppTitleMentionResources>
      <ThreadActionCollectors
        coreRegistrations={CORE_THREAD_ACTIONS}
        requestRename={() => {}}
      />
      <SidebarThreadListContent
        replacement={replacement}
        onNavigate={() => {}}
      />
    </AppTitleMentionResources>
  );
}

function sidebarOrder(threadIds: readonly string[]): string[] {
  return [...document.querySelectorAll("a[data-sidebar-thread-id]")]
    .map((link) => link.getAttribute("data-sidebar-thread-id") ?? "")
    .filter((threadId) => threadIds.includes(threadId));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

it("renders only the changed row on a thread update, and no row while typing an answer", async () => {
  const queryClient = prepareThreadList();
  render(
    <SidebarThreadListHarness queryClient={queryClient}>
      <ThreadList />
      <section aria-label="Question">
        <QuestionForm
          draftKey="thr_question:pint_1"
          questions={[
            {
              id: "q1",
              prompt: "Which color?",
              shortLabel: "Color",
              multiSelect: false,
              required: true,
              allowFreeText: true,
              options: [
                { value: "red", label: "Red" },
                { value: "blue", label: "Blue" },
              ],
            },
          ]}
          disabled={false}
          cancelDisabled={false}
          onSubmit={async () => {}}
          onCancel={async () => {}}
        />
      </section>
    </SidebarThreadListHarness>,
  );
  await settle();
  expect(renderedRows.has("thr_1")).toBe(true);
  expect(renderedRows.has("thr_2")).toBe(true);

  renderedRows.clear();
  await act(async () => {
    patchThreadEntity(queryClient, "thr_1", { title: "Renamed thread" });
  });
  await settle();
  expect(screen.getByText("Renamed thread")).toBeTruthy();
  expect([...renderedRows]).toEqual(["thr_1"]);

  const question = within(screen.getByRole("region", { name: "Question" }));
  fireEvent.click(question.getByRole("button", { name: /Other/ }));
  const answer = question.getByRole("textbox");
  renderedRows.clear();
  for (const value of ["b", "bl", "blu", "blue"]) {
    fireEvent.change(answer, { target: { value } });
  }
  await settle();
  expect(answer).toHaveProperty("value", "blue");
  expect([...renderedRows]).toEqual([]);
});

it("moves a row when its sort order changes while nothing is being dragged", async () => {
  const queryClient = prepareThreadList();
  render(
    <SidebarThreadListHarness queryClient={queryClient}>
      <ThreadList />
    </SidebarThreadListHarness>,
  );
  await settle();
  expect(sidebarOrder(["thr_5", "thr_7"])).toEqual(["thr_5", "thr_7"]);

  await act(async () => {
    patchThreadEntity(queryClient, "thr_7", {
      updatedAt: 9_000_000,
      latestAttentionAt: 9_000_000,
    });
  });
  await settle();
  expect(sidebarOrder(["thr_5", "thr_7"])).toEqual(["thr_7", "thr_5"]);
});
