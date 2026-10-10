// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const draftIds = vi.hoisted(() => {
  let current: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: ReadonlySet<string>) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("@get-bb/plugin-sdk/app", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSidebarThreadDraftIds: () =>
      useSyncExternalStore(draftIds.subscribe, draftIds.get),
  };
});

const { SidebarDraftPresenceSync, useThreadsHaveDraft } =
  await import("./sidebarDraftPresence.js");

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
  draftIds.set(new Set());
});

describe("sidebar draft presence", () => {
  it("re-renders only the collapsed row whose hidden thread gains a draft", () => {
    render(<SidebarProbe />);
    const initialCounts = new Map(renderCounts);

    act(() => draftIds.set(new Set(["thr_child_7"])));

    expect(screen.getByTestId("row_7").textContent).toBe("draft");
    expect(screen.getByTestId("row_8").textContent).toBe("none");
    const rowsRenderedByDraft = [...renderCounts].filter(
      ([id, count]) => count > (initialCounts.get(id) ?? 0),
    );
    expect(rowsRenderedByDraft.map(([id]) => id)).toEqual(["row_7"]);
  });

  it("clears the dot when the hidden draft is emptied", () => {
    draftIds.set(new Set(["thr_child_3"]));
    render(<SidebarProbe />);
    expect(screen.getByTestId("row_3").textContent).toBe("draft");

    act(() => draftIds.set(new Set()));

    expect(screen.getByTestId("row_3").textContent).toBe("none");
  });

  it("keeps the dots while another sidebar list is still mounted", () => {
    draftIds.set(new Set(["thr_child_5"]));
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
