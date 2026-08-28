// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import * as fileSearchSuggestions from "@/hooks/useFileSearchSuggestions";
import * as recentItems from "./threadRecentItems";
import { NewTabFileSearch } from "./NewTabFileSearch";

const useFileSearchSuggestions = vi.spyOn(
  fileSearchSuggestions,
  "useFileSearchSuggestions",
);
const useThreadRecentItems = vi.spyOn(recentItems, "useThreadRecentItems");

beforeEach(() => {
  useFileSearchSuggestions.mockReturnValue({
    suggestions: [],
    isLoading: false,
    fileSearchError: false,
    isDebouncing: false,
    isUnavailable: false,
  });
  useThreadRecentItems.mockReturnValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockPointerCoarse(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
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

function renderFileSearch({
  autoFocus,
  onAutoFocusHandled = () => undefined,
}: {
  autoFocus: boolean;
  onAutoFocusHandled?: () => void;
}) {
  render(
    <NewTabFileSearch
      autoFocus={autoFocus}
      projectId="proj_1"
      environmentId="env_1"
      currentThreadId="thr_1"
      idleActions={null}
      onAutoFocusHandled={onAutoFocusHandled}
      onSelect={() => {}}
    />,
  );
}

describe("NewTabFileSearch", () => {
  it("does not autofocus when passively remounted", () => {
    mockPointerCoarse(false);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});

    renderFileSearch({ autoFocus: false });

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("consumes an explicit request without focusing on coarse pointers", () => {
    mockPointerCoarse(true);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});
    const onAutoFocusHandled = vi.fn();

    renderFileSearch({ autoFocus: true, onAutoFocusHandled });

    expect(focusSpy).not.toHaveBeenCalled();
    expect(onAutoFocusHandled).toHaveBeenCalledTimes(1);
  });

  it("autofocuses for an explicit request and consumes it", () => {
    mockPointerCoarse(false);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});
    const onAutoFocusHandled = vi.fn();
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame = callback;
      return 1;
    });

    renderFileSearch({ autoFocus: true, onAutoFocusHandled });

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(onAutoFocusHandled).toHaveBeenCalledTimes(1);

    act(() => nextFrame?.(0));

    expect(focusSpy).toHaveBeenCalledTimes(2);
  });
});
