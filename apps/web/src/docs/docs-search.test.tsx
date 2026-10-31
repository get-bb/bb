// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTrackDocsSearch } from "./docs-search";

const trackLandingEvent = vi.hoisted(() => vi.fn());

vi.mock("../landing/analytics", () => ({ trackLandingEvent }));

let flush: () => void = () => {};

function Probe({ query, count }: { query: string | null; count: number }) {
  flush = useTrackDocsSearch(query, count);
  return null;
}

describe("docs search tracking", () => {
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    trackLandingEvent.mockReset();
  });

  function show(query: string | null, count: number) {
    act(() => root.render(<Probe query={query} count={count} />));
  }

  it("sends one event per settled query with only a result count bucket", () => {
    show("w", 9);
    act(() => vi.advanceTimersByTime(500));
    show("wo", 7);
    act(() => vi.advanceTimersByTime(500));
    show("worktree", 3);
    act(() => vi.advanceTimersByTime(1000));
    show("worktree", 3);
    act(() => vi.advanceTimersByTime(1000));

    expect(trackLandingEvent.mock.calls).toEqual([
      [{ name: "docs_search_used", properties: { result_count: "1-5" } }],
    ]);
  });

  it.each([
    [0, "0"],
    [5, "1-5"],
    [6, "6+"],
  ])("buckets %i results as %s", (count, bucket) => {
    show(`query ${count}`, count);
    act(() => vi.advanceTimersByTime(1000));
    expect(trackLandingEvent).toHaveBeenCalledWith({
      name: "docs_search_used",
      properties: { result_count: bucket },
    });
  });

  it("sends nothing while a search is pending or cleared", () => {
    show(null, 0);
    act(() => vi.advanceTimersByTime(1000));
    show("tabs", 2);
    act(() => vi.advanceTimersByTime(400));
    show("", 0);
    act(() => vi.advanceTimersByTime(1000));
    expect(trackLandingEvent).not.toHaveBeenCalled();
  });

  it("sends the pending search once when a result opens before it settles", () => {
    show("worktree", 3);
    act(() => vi.advanceTimersByTime(200));
    act(() => flush());
    act(() => vi.advanceTimersByTime(1000));
    act(() => flush());

    expect(trackLandingEvent.mock.calls).toEqual([
      [{ name: "docs_search_used", properties: { result_count: "1-5" } }],
    ]);
  });
});
