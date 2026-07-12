// @vitest-environment jsdom

import { useState, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider, useAtomValue } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
} from "./sidebarCollapsedAtoms";

function StateProbe() {
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const chronologicalSort = useAtomValue(sidebarChronologicalSortAtom);

  return (
    <>
      <div data-testid="organization-mode">{organizationMode}</div>
      <div data-testid="chronological-sort">{chronologicalSort}</div>
    </>
  );
}

function createSidebarViewStore() {
  const store = createStore();
  store.set(sidebarOrganizationModeAtom, "project");
  store.set(sidebarChronologicalSortAtom, "updated");
  return store;
}

function ControlledDisplayOptionsMenu() {
  const [open, setOpen] = useState(true);

  return <SidebarDisplayOptionsMenu open={open} onOpenChange={setOpen} />;
}

function renderMobileViewOptions(children: ReactNode) {
  render(
    <CompactViewportOverrideProvider isCompactViewport={true}>
      <JotaiProvider store={createSidebarViewStore()}>
        <TooltipProvider>
          {children}
          <StateProbe />
        </TooltipProvider>
      </JotaiProvider>
    </CompactViewportOverrideProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("sidebar display options menu", () => {
  it("switches organization mode and closes like a standard menu", async () => {
    renderMobileViewOptions(<ControlledDisplayOptionsMenu />);

    const trigger = screen.getByRole("button", {
      name: "Sidebar display options",
      hidden: true,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const organizeGroup = await screen.findByRole("group", {
      name: "Organize",
    });
    const byProjectOption = within(organizeGroup).getByRole(
      "menuitemcheckbox",
      { name: "By project" },
    );
    const inOneListOption = within(organizeGroup).getByRole(
      "menuitemcheckbox",
      { name: "In one list" },
    );

    expect(byProjectOption.getAttribute("aria-checked")).toBe("true");
    expect(inOneListOption.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(inOneListOption);

    expect(screen.getByTestId("organization-mode").textContent).toBe(
      "chronological",
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(
      (
        await screen.findByRole("menuitemcheckbox", { name: "In one list" })
      ).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("switches to machine organization", async () => {
    renderMobileViewOptions(<ControlledDisplayOptionsMenu />);

    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "By machine" }),
    );

    expect(screen.getByTestId("organization-mode").textContent).toBe(
      "machine",
    );
  });

  it("selects one fixed-direction sort field and closes", async () => {
    renderMobileViewOptions(<ControlledDisplayOptionsMenu />);

    const trigger = screen.getByRole("button", {
      name: "Sidebar display options",
      hidden: true,
    });

    const sortGroup = await screen.findByRole("group", { name: "Sort by" });
    const updatedOption = within(sortGroup).getByRole("menuitemcheckbox", {
      name: "Updated at",
    });
    const createdOption = within(sortGroup).getByRole("menuitemcheckbox", {
      name: "Created at",
    });

    expect(updatedOption.getAttribute("aria-checked")).toBe("true");
    expect(createdOption.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(createdOption);

    expect(screen.getByTestId("chronological-sort").textContent).toBe(
      "created",
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    const reopenedSortGroup = await screen.findByRole("group", {
      name: "Sort by",
    });
    expect(
      within(reopenedSortGroup)
        .getByRole("menuitemcheckbox", { name: "Created at" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(reopenedSortGroup)
        .getByRole("menuitemcheckbox", { name: "Updated at" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("selects alphabetical order", async () => {
    renderMobileViewOptions(<ControlledDisplayOptionsMenu />);

    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Alphabetical" }),
    );

    expect(screen.getByTestId("chronological-sort").textContent).toBe("alpha");
  });
});
