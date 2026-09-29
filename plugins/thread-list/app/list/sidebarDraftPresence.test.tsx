// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const draftIds = vi.hoisted(() => ({
  current: new Set<string>() as ReadonlySet<string>,
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSidebarThreadDraftIds: () => draftIds.current,
}));

const { SidebarDraftPresenceSync, useThreadsHaveDraft } = await import(
  "./sidebarDraftPresence.js"
);

const renderCounts = new Map<string, number>();

const CollapsedRowProbe = memo(function CollapsedRowProbe({
  id,
  threadIds,
}: {
  id: string;
  threadIds: readonly string[];
}) {
  renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
  const hasDraft = useThreadsHaveDraft(threadIds);
  return <span data-testid={id}>{hasDraft ? "draft" : "none"}</span>;
});

const ROW_THREAD_IDS = Array.from({ length: 50 }, (_, index) => [
  `thr_child_${index}`,
]);

function SidebarProbe() {
  return (
    <>
      <SidebarDraftPresenceSync />
      {ROW_THREAD_IDS.map((threadIds, index) => (
        <CollapsedRowProbe
          key={index}
          id={`row_${index}`}
          threadIds={threadIds}
        />
      ))}
    </>
  );
}

afterEach(() => {
  cleanup();
  renderCounts.clear();
  draftIds.current = new Set();
});

describe("sidebar draft presence", () => {
  it("re-renders only the collapsed row whose hidden thread gains a draft", () => {
    const view = render(<SidebarProbe />);
    const initialCounts = new Map(renderCounts);

    draftIds.current = new Set(["thr_child_7"]);
    view.rerender(<SidebarProbe />);

    expect(screen.getByTestId("row_7").textContent).toBe("draft");
    expect(screen.getByTestId("row_8").textContent).toBe("none");
    const rowsRenderedByDraft = [...renderCounts].filter(
      ([id, count]) => count > (initialCounts.get(id) ?? 0),
    );
    expect(rowsRenderedByDraft.map(([id]) => id)).toEqual(["row_7"]);
  });

  it("clears the dot when the hidden draft is emptied", () => {
    draftIds.current = new Set(["thr_child_3"]);
    const view = render(<SidebarProbe />);
    expect(screen.getByTestId("row_3").textContent).toBe("draft");

    draftIds.current = new Set();
    act(() => view.rerender(<SidebarProbe />));

    expect(screen.getByTestId("row_3").textContent).toBe("none");
  });

  it("keeps the dots while another sidebar list is still mounted", () => {
    draftIds.current = new Set(["thr_child_5"]);
    function TwoLists({ withSecond }: { withSecond: boolean }) {
      return (
        <>
          {withSecond ? <SidebarDraftPresenceSync /> : null}
          <SidebarProbe />
        </>
      );
    }
    const view = render(<TwoLists withSecond />);
    expect(screen.getByTestId("row_5").textContent).toBe("draft");
    const rowRendersBefore = renderCounts.get("row_5");

    act(() => view.rerender(<TwoLists withSecond={false} />));

    expect(renderCounts.get("row_5")).toBe(rowRendersBefore);
    expect(screen.getByTestId("row_5").textContent).toBe("draft");
  });
});
