// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { PluginThreadTitle } from "./PluginThreadTitle";

const state = vi.hoisted(() => ({
  threads: [] as ThreadListEntry[],
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      projects: [{ id: "proj_app", name: "App", threads: state.threads }],
      personalProject: {
        id: PERSONAL_PROJECT_ID,
        name: "Personal",
        threads: [],
      },
    },
    isError: false,
  }),
}));

afterEach(() => {
  cleanup();
  state.threads = [];
});

describe("PluginThreadTitle", () => {
  it("renders the display title with section mentions resolved to chips", () => {
    state.threads = [
      makeThreadListEntry({
        id: "thr_1",
        projectId: "proj_app",
        title: "Triage @section:sec_slop",
      }),
    ];
    render(
      <ThreadTitleMentionResourcesProvider
        sectionNamesById={new Map([["sec_slop", "Slop Cop"]])}
        projectNamesById={new Map()}
        threadById={new Map()}
      >
        <PluginThreadTitle threadId="thr_1" />
      </ThreadTitleMentionResourcesProvider>,
    );
    expect(screen.getByText("Triage")).toBeTruthy();
    expect(screen.getByText("Slop Cop")).toBeTruthy();
    expect(screen.queryByText(/@section/)).toBeNull();
  });

  it("falls back to the title fallback and renders nothing for an unknown id", () => {
    state.threads = [
      makeThreadListEntry({
        id: "thr_2",
        projectId: "proj_app",
        title: null,
        titleFallback: "Untitled work",
      }),
    ];
    const { container } = render(
      <>
        <PluginThreadTitle threadId="thr_2" />
        <PluginThreadTitle threadId="thr_missing" />
      </>,
    );
    expect(screen.getByText("Untitled work")).toBeTruthy();
    expect(container.textContent).toBe("Untitled work");
  });
});
