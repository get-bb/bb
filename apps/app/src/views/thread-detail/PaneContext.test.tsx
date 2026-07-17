// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getThreadRoutePath } from "@/lib/route-paths";
import { DefaultPaneContextProvider, usePaneContext } from "./PaneContext";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDefaultPaneContext() {
  return renderHook(() => usePaneContext(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <DefaultPaneContextProvider>{children}</DefaultPaneContextProvider>
    ),
  });
}

describe("DefaultPaneContextProvider", () => {
  it("provides focused main-pane navigation", () => {
    const { result } = renderDefaultPaneContext();
    const thread = { projectId: "proj_1", threadId: "thr_1" };

    expect(result.current.paneId).toBe("main");
    expect(result.current.isFocused).toBe(true);

    act(() => {
      result.current.navigateInPane(thread);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(getThreadRoutePath(thread));
  });
});
