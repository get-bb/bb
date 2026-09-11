// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftContentSchema, type Draft } from "@bb/server-contract";
import type { RecoverableDraftSnapshot } from "@/lib/drafts/resource-store";
import { openDraftInSplit } from "@/lib/split-layout/openDraftInSplit";
import { DraftRows } from "./DraftRows";

const state = vi.hoisted(() => ({
  remote: [] as Draft[],
  local: [] as RecoverableDraftSnapshot[],
}));

vi.mock("@/hooks/queries/draft-queries", () => ({
  useDrafts: () => ({
    data: { pages: [{ drafts: state.remote, nextOffset: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
  }),
}));
vi.mock("@/hooks/useDraftResource", () => ({
  useRecoverableDrafts: () => state.local,
}));
vi.mock("./TopLevelSidebarSection", () => ({
  TopLevelSidebarSection: ({
    label,
    children,
  }: {
    label: string;
    children: ReactNode;
  }) => <section aria-label={label}>{children}</section>,
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitDrag: () => ({}),
}));
vi.mock("./paneContentSplitIndicator", () => ({
  usePaneContentSplitIndicator: () => ({ miniMap: null, isOpenInSplit: false }),
}));
vi.mock("@/lib/split-layout/openDraftInSplit", () => ({
  openDraftInSplit: vi.fn(),
}));

afterEach(() => {
  cleanup();
  state.remote = [];
  state.local = [];
  vi.clearAllMocks();
});

describe("sidebar draft rows", () => {
  it("keeps missing-project drafts recoverable and opens their preserved identity normally or in a split", () => {
    state.remote = [
      {
        id: "drf_missingproject",
        revision: 1,
        createdAt: 1,
        updatedAt: 2,
        content: draftContentSchema.parse({
          projectId: "proj_deleted",
          prompt: { text: "Recover the plan" },
        }),
      },
    ];
    render(
      <Provider>
        <MemoryRouter initialEntries={["/?draft=drf_missingproject"]}>
          <DraftRows projects={[]} />
        </MemoryRouter>
      </Provider>,
    );
    const row = screen.getByRole("link", {
      name: /Recover the plan, draft, Project unavailable/,
    });
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.getAttribute("href")).toBe("/?draft=drf_missingproject");
    expect(screen.getByText("Project unavailable")).not.toBeNull();
    fireEvent.click(row);
    expect(openDraftInSplit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draftId: "drf_missingproject",
        split: "replace",
      }),
    );
    fireEvent.click(row, { metaKey: true });
    expect(openDraftInSplit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draftId: "drf_missingproject",
        split: "right",
      }),
    );
  });

  it("shows a locally recovered message before it appears in the server list", () => {
    state.local = [
      {
        id: "drf_pendingdraft",
        content: draftContentSchema.parse({
          prompt: { text: "Pending message" },
        }),
        updatedAt: 3,
        status: "error",
        error: new Error("Offline"),
        persistenceError: null,
      },
    ];
    render(
      <Provider>
        <MemoryRouter>
          <DraftRows projects={[]} />
        </MemoryRouter>
      </Provider>,
    );
    expect(
      screen.getByRole("link", { name: /Pending message, draft/ }),
    ).not.toBeNull();
    expect(screen.getByText("Not saved")).not.toBeNull();
  });
});
