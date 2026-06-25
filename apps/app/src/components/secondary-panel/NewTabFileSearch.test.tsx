// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@/components/ui/hooks/use-pointer-coarse";
import { NewTabFileSearch } from "./NewTabFileSearch";

vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: () => ({
    suggestions: [],
    isLoading: false,
    fileSearchError: false,
    isDebouncing: false,
    isUnavailable: false,
  }),
}));

vi.mock("./threadRecentItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./threadRecentItems")>();
  return {
    ...actual,
    useThreadRecentItems: () => [],
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockPointerCoarse(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY && matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderFileSearch() {
  render(
    <NewTabFileSearch
      projectId="proj_1"
      environmentId="env_1"
      currentThreadId="thr_1"
      focusRequest={0}
      idleActions={null}
      onSelect={() => {}}
    />,
  );
}

describe("NewTabFileSearch", () => {
  it("does not autofocus the search input on coarse pointers", () => {
    mockPointerCoarse(true);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});

    renderFileSearch();

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("autofocuses the search input on fine pointers", () => {
    mockPointerCoarse(false);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});

    renderFileSearch();

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
