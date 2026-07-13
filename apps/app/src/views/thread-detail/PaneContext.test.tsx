// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPopoutThreadRoutePath,
  getThreadRoutePath,
  type ThreadRouteSurface,
} from "@/lib/route-paths";
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

function renderDefaultPaneContext(surface: ThreadRouteSurface) {
  return renderHook(() => usePaneContext(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <DefaultPaneContextProvider surface={surface}>
        {children}
      </DefaultPaneContextProvider>
    ),
  });
}

describe("DefaultPaneContextProvider", () => {
  it.each([
    ["page", getThreadRoutePath],
    ["popout", getPopoutThreadRoutePath],
  ] satisfies readonly [ThreadRouteSurface, typeof getThreadRoutePath][])(
    "provides focused main-pane navigation for the %s surface",
    (surface, getRoutePath) => {
      const { result } = renderDefaultPaneContext(surface);
      const thread = { projectId: "proj_1", threadId: "thr_1" };

      expect(result.current.paneId).toBe("main");
      expect(result.current.isFocused).toBe(true);

      act(() => {
        result.current.navigateInPane(thread);
      });

      expect(mocks.navigate).toHaveBeenCalledWith(getRoutePath(thread));
    },
  );
});
