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
  sidebarSortDirectionAtom,
} from "./sidebarCollapsedAtoms";

function StateProbe() {
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const chronologicalSort = useAtomValue(sidebarChronologicalSortAtom);
  const sortDirection = useAtomValue(sidebarSortDirectionAtom);

  return (
    <>
      <div data-testid="organization-mode">{organizationMode}</div>
      <div data-testid="chronological-sort">{chronologicalSort}</div>
      <div data-testid="sort-direction">{sortDirection}</div>
    </>
  );
}

function createSidebarViewStore() {
  const store = createStore();
  store.set(sidebarOrganizationModeAtom, "project");
  store.set(sidebarChronologicalSortAtom, "updated");
  store.set(sidebarSortDirectionAtom, "desc");
  return store;
}

// The combined menu closes only on outside click / Escape, never on a
// selection. A controlled wrapper starts open and records every open-state
// change so tests can assert the menu was never asked to close.
function ControlledDisplayOptionsMenu({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <SidebarDisplayOptionsMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        onOpenChange(nextOpen);
      }}
    />
  );
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
  it("switches organization mode and keeps the menu open", async () => {
    const onOpenChange = vi.fn();

    renderMobileViewOptions(
      <ControlledDisplayOptionsMenu onOpenChange={onOpenChange} />,
    );

    const trigger = screen.getByRole("button", {
      name: "Sidebar display options",
      hidden: true,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const organizeGroup = await screen.findByRole("radiogroup", {
      name: "Organize by",
    });
    fireEvent.click(within(organizeGroup).getByRole("radio", { name: "Manual" }));

    expect(screen.getByTestId("organization-mode").textContent).toBe(
      "chronological",
    );
    // A selection never closes the menu.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("activates a new sort field descending and keeps the menu open", async () => {
    const onOpenChange = vi.fn();

    renderMobileViewOptions(
      <ControlledDisplayOptionsMenu onOpenChange={onOpenChange} />,
    );

    fireEvent.click(await screen.findByRole("menuitem", { name: "Created at" }));

    expect(screen.getByTestId("chronological-sort").textContent).toBe(
      "created",
    );
    expect(screen.getByTestId("sort-direction").textContent).toBe("desc");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // The menu content is still mounted, so a follow-up selection is possible.
    expect(
      screen.queryByRole("menuitem", { name: "Created at" }),
    ).not.toBeNull();
  });

  it("flips direction when re-selecting the active sort field", async () => {
    renderMobileViewOptions(
      <ControlledDisplayOptionsMenu onOpenChange={vi.fn()} />,
    );

    // "Updated at" is the seeded active field (desc); re-selecting it flips.
    fireEvent.click(await screen.findByRole("menuitem", { name: "Updated at" }));

    expect(screen.getByTestId("chronological-sort").textContent).toBe(
      "updated",
    );
    expect(screen.getByTestId("sort-direction").textContent).toBe("asc");
  });

  it("starts alphabetical ascending", async () => {
    renderMobileViewOptions(
      <ControlledDisplayOptionsMenu onOpenChange={vi.fn()} />,
    );

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Alphabetical" }),
    );

    expect(screen.getByTestId("chronological-sort").textContent).toBe("alpha");
    expect(screen.getByTestId("sort-direction").textContent).toBe("asc");
  });
});
