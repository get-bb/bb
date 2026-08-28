// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { getThreadRoutePath } from "@/lib/route-paths";
import { DefaultPaneContextProvider, usePaneContext } from "./PaneContext";

afterEach(() => {
  cleanup();
});

function renderDefaultPaneContext() {
  return renderHook(
    () => ({ context: usePaneContext(), location: useLocation() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter>
          <DefaultPaneContextProvider>{children}</DefaultPaneContextProvider>
        </MemoryRouter>
      ),
    },
  );
}

describe("DefaultPaneContextProvider", () => {
  it("provides focused main-pane navigation", () => {
    const { result } = renderDefaultPaneContext();
    const thread = { projectId: "proj_1", threadId: "thr_1" };

    expect(result.current.context.paneId).toBe("main");
    expect(result.current.context.isFocused).toBe(true);

    act(() => {
      result.current.context.navigateInPane(thread);
    });

    expect(result.current.location.pathname).toBe(getThreadRoutePath(thread));
  });
});
