// @vitest-environment jsdom

import { useState, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider, useAtomValue } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarGroupOptionsMenu, SidebarSortOptionsMenu } from "./ProjectList";
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

function ControlledGroupOptionsMenu({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <SidebarGroupOptionsMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        onOpenChange(nextOpen);
      }}
    />
  );
}

function ControlledSortOptionsMenu({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <SidebarSortOptionsMenu
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

describe("sidebar view options menus", () => {
  it("closes the mobile organize drawer after changing organization", async () => {
    const onOpenChange = vi.fn();

    renderMobileViewOptions(
      <ControlledGroupOptionsMenu onOpenChange={onOpenChange} />,
    );

    const trigger = screen.getByRole("button", {
      name: "Sidebar organize options",
      hidden: true,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(await screen.findByRole("menuitem", { name: "Manually" }));

    expect(screen.getByTestId("organization-mode").textContent).toBe(
      "chronological",
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("closes the mobile sort drawer after changing sort", async () => {
    const onOpenChange = vi.fn();

    renderMobileViewOptions(
      <ControlledSortOptionsMenu onOpenChange={onOpenChange} />,
    );

    const trigger = screen.getByRole("button", {
      name: "Sidebar sort options",
      hidden: true,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(await screen.findByRole("menuitem", { name: "Created at" }));

    expect(screen.getByTestId("chronological-sort").textContent).toBe(
      "created",
    );
    expect(screen.getByTestId("sort-direction").textContent).toBe("desc");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
  });
});
