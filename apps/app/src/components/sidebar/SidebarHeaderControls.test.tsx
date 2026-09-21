// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { SidebarOrganizationMode } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SIDEBAR_CONTROL_STATE_CLASS } from "./sidebarRowClasses";
import {
  SidebarHeaderActionsProvider,
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} from "./SidebarHeaderControls";
import {
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  sidebarEnvironmentGroupingAtom,
  sidebarSortDirectionAtom,
  sidebarThreadLifecyclesAtom,
} from "./sidebarCollapsedAtoms";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewport.compact,
}));

afterEach(() => {
  cleanup();
  viewport.compact = false;
});

function setup(
  label = "Pinned",
  section = false,
  organization: SidebarOrganizationMode = "project",
) {
  const store = createStore();
  store.set(sidebarThreadLifecyclesAtom, ["active"]);
  store.set(sidebarOrganizationModeAtom, organization);
  store.set(sidebarChronologicalSortAtom, "updated");
  store.set(sidebarSortDirectionAtom, "default");
  store.set(sidebarEnvironmentGroupingAtom, "auto");
  const newThread = vi.fn();
  const newProject = vi.fn();
  const newSection = vi.fn();
  render(
    <Provider store={store}>
      <TooltipProvider>
        <SidebarHeaderActionsProvider
          value={{ onNewProject: newProject, onNewSection: newSection }}
        >
          <SidebarHeaderControls label={label} onNewThread={newThread}>
            {section && (
              <SidebarSectionMenuItems onRename={vi.fn()} onRemove={vi.fn()} />
            )}
          </SidebarHeaderControls>
        </SidebarHeaderActionsProvider>
      </TooltipProvider>
    </Provider>,
  );
  return { store, newThread, newProject, newSection };
}

async function openMenu(label = "Pinned") {
  fireEvent.keyDown(
    screen.getByRole("button", {
      name: new RegExp(`^${label} actions(?:;|$)`),
    }),
    {
      key: "Enter",
    },
  );
  await screen.findByRole("menuitem", { name: "New project" });
}

async function openSubmenu(label: string) {
  fireEvent.keyDown(screen.getByRole("menuitem", { name: label }), {
    key: "ArrowRight",
  });
}

describe("sidebar header controls", () => {
  it("supports keyboard selection when the menu first loads", async () => {
    const { store } = setup("Pinned", false, "chronological");
    await openMenu();
    const newProject = screen.getByRole("menuitem", { name: "New project" });
    fireEvent.keyDown(newProject.closest('[role="menu"]')!, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(newProject));
    await openSubmenu("Organize");
    const project = await screen.findByRole("menuitemradio", {
      name: "By project",
    });
    fireEvent.keyDown(project.closest('[role="menu"]')!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(project));
    fireEvent.keyDown(project, { key: "Enter" });
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
  });

  it("dismisses on the first outside click after toggling environment grouping", async () => {
    setup();
    await openMenu();
    await openSubmenu("Organize");
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "By environment",
    });
    fireEvent.pointerDown(toggle, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(toggle, { button: 0, pointerType: "mouse" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(document.body, { button: 0, pointerType: "mouse" });
    fireEvent.click(document.body);
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitemcheckbox", { name: "By environment" }),
      ).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "New project" }),
      ).toBeNull();
    });
  });

  it("keeps the primary before overflow and applies the shared control state", async () => {
    const { newThread } = setup("Pinned", false, "chronological");
    const primary = screen.getByRole("button", {
      name: "New thread in Pinned",
    });
    expect(primary.nextElementSibling?.getAttribute("aria-label")).toBe(
      "Pinned actions",
    );
    for (const control of [primary, primary.nextElementSibling]) {
      for (const token of SIDEBAR_CONTROL_STATE_CLASS.split(" ")) {
        expect(control?.classList.contains(token)).toBe(true);
      }
      expect(control?.classList.contains("hover:bg-sidebar-accent")).toBe(
        false,
      );
      expect(control?.classList.contains("hover:text-foreground")).toBe(false);
      expect(control?.classList.contains("focus-visible:ring-1")).toBe(true);
      expect(control?.classList.contains("focus-visible:ring-ring")).toBe(true);
      expect(control?.className).not.toMatch(/focus-visible:(bg-|ring-[02]\b)/);
    }
    expect(primary.classList.contains("max-md:pointer-coarse:w-8")).toBe(true);
    expect(
      primary.nextElementSibling?.classList.contains(
        "max-md:pointer-coarse:w-9",
      ),
    ).toBe(true);
    expect(
      primary.parentElement?.classList.contains("max-md:pointer-coarse:gap-0"),
    ).toBe(true);
    fireEvent.click(primary);
    expect(newThread).toHaveBeenCalledOnce();
    await openMenu();
    expect(primary.nextElementSibling?.getAttribute("data-state")).toBe("open");
  });

  it("preserves creation callbacks and separates section editing/removal", async () => {
    const { newSection } = setup("Review", true);
    await openMenu("Review");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "New project",
      "New section",
      "Organize",
      "Sort by",
      "Filter",
      "Rename",
      "Remove",
    ]);
    expect(screen.getAllByRole("separator")).toHaveLength(3);
    fireEvent.click(screen.getByRole("menuitem", { name: "New section" }));
    expect(newSection).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "New project" }),
      ).toBeNull(),
    );
  });

  it.each([false, true])(
    "changes filtering through plain combined-menu controls (compact=%s)",
    async (compact) => {
      viewport.compact = compact;
      const { store } = setup();
      const trigger = screen.getByRole("button", { name: "Pinned actions" });
      act(() => {
        store.set(sidebarOrganizationModeAtom, "machine");
        store.set(sidebarChronologicalSortAtom, "created");
        store.set(sidebarSortDirectionAtom, "ascending");
      });
      expect(trigger.querySelector('[data-icon="MoreHorizontal"]')).toBeTruthy();
      expect(trigger.classList.contains("bg-state-active")).toBe(false);
      expect(trigger.hasAttribute("aria-pressed")).toBe(false);
      expect(trigger.hasAttribute("aria-describedby")).toBe(false);
      if (compact) fireEvent.click(trigger);
      else await openMenu();
      const filter = await screen.findByRole("menuitem", {
        name: "Filter",
      });
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual(["New project", "New section", "Organize", "Sort by", "Filter"]);
      if (compact) fireEvent.click(filter);
      else await openSubmenu("Filter");
      const archived = await screen.findByRole("menuitemcheckbox", {
        name: "Archived",
      });
      fireEvent.click(archived);
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual([
        "active",
        "archived",
      ]);
      expect(screen.queryByRole("menuitem", { name: /^Reset/ })).toBeNull();
      expect(store.get(sidebarOrganizationModeAtom)).toBe("machine");
      expect(store.get(sidebarChronologicalSortAtom)).toBe("created");
      if (compact) {
        expect(
          screen.getByRole("dialog", { name: "Filter" }),
        ).toBeTruthy();
        expect(trigger.closest("[inert], [aria-hidden='true']")).toBeNull();
        fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
        expect(
          screen.getByRole("menuitem", { name: "New project" }),
        ).toBeTruthy();
      }
    },
  );

  it("keeps Organize open and exclusive across selections", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Organize");
    const machine = await screen.findByRole("menuitemradio", {
      name: "By machine",
    });
    expect(
      screen
        .getByRole("menuitemradio", { name: "By project" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(machine);
    expect(store.get(sidebarOrganizationModeAtom)).toBe("machine");
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemradio", { name: "By machine" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: "By project" })
        .getAttribute("aria-checked"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemradio", { name: "Custom" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("preserves the existing Organize groups without a Reset action", async () => {
    const { store } = setup("Pinned", false, "chronological");
    act(() => store.set(sidebarEnvironmentGroupingAtom, true));
    await openMenu();
    await openSubmenu("Organize");
    const grouping = await screen.findByRole("menuitemcheckbox", { name: "By environment" });
    expect(screen.getByRole("group", { name: "Groups" })).toBeTruthy();
    expect(grouping.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(grouping);
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "By project" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    expect(screen.queryByRole("menuitem", { name: /^Reset/ })).toBeNull();
  });

  it("resolves legacy sort, toggles direction, and resets it for another field", async () => {
    const { store } = setup();
    act(() => store.set(sidebarChronologicalSortAtom, "none"));
    await openMenu();
    await openSubmenu("Sort by");
    const updated = await screen.findByRole("menuitemradio", {
      name: "Updated at, descending. Sort ascending",
    });
    expect(updated.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(updated);
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    fireEvent.click(
      screen.getByRole("menuitemradio", {
        name: "Updated at, ascending. Sort descending",
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("descending");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Alphabetical" }),
    );
    expect(store.get(sidebarChronologicalSortAtom)).toBe("alpha");
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    expect(screen.queryByRole("menuitem", { name: /^Reset/ })).toBeNull();
    expect(
      screen
        .getByRole("menuitemradio", {
          name: "Alphabetical, ascending. Sort descending",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("announces compact sort direction and resets the nested page after closing", async () => {
    viewport.compact = true;
    const { store } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /^Pinned actions(?:;|$)/ }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sort by" }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /Updated at\s*, descending\. Sort ascending/,
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    expect(
      screen
        .getByRole("menuitemradio", {
          name: /Updated at\s*, ascending\. Sort descending/,
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Organize" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    expect(
      screen
        .getByRole("menuitemradio", { name: "Custom" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: /^Pinned actions(?:;|$)/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Pinned actions(?:;|$)/ }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "New project" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull();
  });
});
