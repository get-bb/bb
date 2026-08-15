// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import { SIDEBAR_SHOW_THREAD_NUMBERS_STORAGE_KEY } from "./sidebarCollapsedAtoms";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderMenu() {
  return render(
    <Provider store={createStore()}>
      <TooltipProvider>
        <SidebarDisplayOptionsMenu open onOpenChange={() => {}} />
      </TooltipProvider>
    </Provider>,
  );
}

describe("sidebar display options", () => {
  it("keeps thread numbers off by default and remembers when they are shown", () => {
    const firstRender = renderMenu();
    const threadNumbers = screen.getByRole("menuitemcheckbox", {
      name: "Thread numbers",
    });

    expect(threadNumbers.getAttribute("aria-checked")).toBe("false");
    expect(
      window.localStorage.getItem(SIDEBAR_SHOW_THREAD_NUMBERS_STORAGE_KEY),
    ).toBeNull();

    fireEvent.click(threadNumbers);

    expect(threadNumbers.getAttribute("aria-checked")).toBe("true");
    expect(
      window.localStorage.getItem(SIDEBAR_SHOW_THREAD_NUMBERS_STORAGE_KEY),
    ).toBe("true");

    firstRender.unmount();
    renderMenu();

    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Thread numbers" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
