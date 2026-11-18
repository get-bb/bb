// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import type { FilePathSearchSuggestion } from "@/hooks/useFileSearchSuggestions";
import { NewTabFileSearch } from "./NewTabFileSearch";

const fileSearch = vi.hoisted(() => ({
  suggestions: [] as FilePathSearchSuggestion[],
  isStale: false,
}));

vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: () => ({
    suggestions: fileSearch.suggestions,
    isLoading: false,
    fileSearchError: false,
    isDebouncing: false,
    isStale: fileSearch.isStale,
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
  fileSearch.suggestions = [];
  fileSearch.isStale = false;
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

function renderFileSearch({
  autoFocus,
  onAutoFocusHandled = () => undefined,
  onSelect = () => {},
}: {
  autoFocus: boolean;
  onAutoFocusHandled?: () => void;
  onSelect?: (file: { source: string; path: string }) => void;
}) {
  return render(
    <NewTabFileSearch
      autoFocus={autoFocus}
      projectId="proj_1"
      environmentId="env_1"
      currentThreadId="thr_1"
      actions={[]}
      onAutoFocusHandled={onAutoFocusHandled}
      onSelect={onSelect}
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

  it("does not open a file found for an earlier query", () => {
    mockPointerCoarse(false);
    fileSearch.suggestions = [
      {
        source: "workspace",
        entryKind: "file",
        path: "src/compiler.ts",
        name: "compiler.ts",
        score: 100,
        positions: [],
      },
    ];
    fileSearch.isStale = true;
    const onSelect = vi.fn();
    const view = renderFileSearch({ autoFocus: false, onSelect });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "src/compo" } });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByText("compiler.ts"));
    expect(onSelect).not.toHaveBeenCalled();

    fileSearch.isStale = false;
    view.rerender(
      <NewTabFileSearch
        autoFocus={false}
        projectId="proj_1"
        environmentId="env_1"
        currentThreadId="thr_1"
        actions={[]}
        onAutoFocusHandled={() => undefined}
        onSelect={onSelect}
      />,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({
      source: "workspace",
      path: "src/compiler.ts",
    });
  });
});
