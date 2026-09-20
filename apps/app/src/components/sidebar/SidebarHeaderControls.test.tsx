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
  it("supports keyboard selection and Reset when a submenu first loads", async () => {
    const { store } = setup("Pinned", false, "chronological");
    await openMenu();
    await openSubmenu("Organize");
    const project = await screen.findByRole("menuitemradio", {
      name: "By project",
    });
    fireEvent.keyDown(project.closest('[role="menu"]')!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(project));
    fireEvent.keyDown(project, { key: "Enter" });
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
    const reset = screen.getByRole("menuitem", { name: "Reset to default" });
    reset.focus();
    fireEvent.keyDown(reset, { key: "Enter" });
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    expect(reset.getAttribute("aria-disabled")).toBe("true");
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
    "keeps lifecycle selection nonempty in the combined menu (compact=%s)",
    async (compact) => {
      viewport.compact = compact;
      const { store } = setup();
      const trigger = screen.getByRole("button", {
        name: /^Pinned actions(?:;|$)/,
      });
      if (compact) fireEvent.click(trigger);
      else await openMenu();
      const filter = await screen.findByRole("menuitem", {
        name: "Filter",
      });
      if (compact) fireEvent.click(filter);
      else await openSubmenu("Filter");
      const active = await screen.findByRole("menuitemcheckbox", {
        name: "Active",
      });
      expect(active.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(active);
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["active"]);
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Drafts" }));
      fireEvent.click(active);
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["draft"]);
      const drafts = screen.getByRole("menuitemcheckbox", { name: "Drafts" });
      expect(drafts.getAttribute("aria-checked")).toBe("true");
      expect(drafts.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "Archived" }),
      );
      expect(store.get(sidebarThreadLifecyclesAtom)).toEqual([
        "draft",
        "archived",
      ]);
      expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
      expect(store.get(sidebarChronologicalSortAtom)).toBe("updated");
      if (compact) {
        expect(
          screen.getByRole("dialog", { name: "Filter" }),
        ).toBeTruthy();
        expect(trigger.closest("[inert], [aria-hidden='true']")).toBeNull();
        fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
        expect(
          screen.getByRole("menuitem", { name: "New project" }),
        ).toBeTruthy();
        expect(screen.getByRole("menuitem", { name: "Organize" })).toBeTruthy();
      }
    },
  );

  it.each([false, true])(
    "keeps ordinary controls and plain menu labels after synced changes (compact=%s)",
    async (compact) => {
      viewport.compact = compact;
      const { store } = setup("Pinned", false, "chronological");
      const trigger = screen.getByRole("button", { name: "Pinned actions" });
      expect(
        trigger.querySelector('[data-icon="MoreHorizontal"]'),
      ).toBeTruthy();
      act(() => {
        store.set(sidebarOrganizationModeAtom, "machine");
        store.set(sidebarChronologicalSortAtom, "created");
        store.set(sidebarSortDirectionAtom, "ascending");
        store.set(sidebarThreadLifecyclesAtom, ["draft", "archived"]);
      });
      expect(
        trigger.querySelector('[data-icon="MoreHorizontal"]'),
      ).toBeTruthy();
      expect(trigger.classList.contains("bg-state-active")).toBe(false);
      expect(trigger.getAttribute("aria-label")).toBe("Pinned actions");
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.hasAttribute("aria-pressed")).toBe(false);
      expect(trigger.hasAttribute("aria-describedby")).toBe(false);
      if (compact) fireEvent.click(trigger);
      else await openMenu();
      await screen.findByRole("menuitem", { name: "Filter" });
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "New project", "New section", "Organize", "Sort by", "Filter",
      ]);
      for (const item of screen.getAllByRole("menuitem")) {
        expect(item.querySelector('[data-icon="ArrowUp"], [data-icon="ArrowDown"]')).toBeNull();
      }
      expect(screen.queryByRole("tooltip")).toBeNull();
    },
  );

  it("treats legacy none, explicit descending, and equivalent grouping as defaults", async () => {
    const { store } = setup("Pinned", false, "chronological");
    act(() => {
      store.set(sidebarChronologicalSortAtom, "none");
      store.set(sidebarSortDirectionAtom, "descending");
      store.set(sidebarEnvironmentGroupingAtom, false);
    });
    expect(
      screen
        .getByRole("button", { name: "Pinned actions" })
        .classList.contains("bg-state-active"),
    ).toBe(false);
    await openMenu();
    await openSubmenu("Sort by");
    const reset = await screen.findByRole("menuitem", { name: "Reset to default" });
    expect(reset.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen
        .getByRole("menuitemradio", {
          name: "Updated at, descending. Sort ascending",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it.each([false, true])(
    "resets each family independently and stays in its menu (compact=%s)",
    async (compact) => {
      viewport.compact = compact;
      const { store } = setup("Pinned", false, "chronological");
      act(() => {
        store.set(sidebarOrganizationModeAtom, "machine");
        store.set(sidebarEnvironmentGroupingAtom, false);
        store.set(sidebarChronologicalSortAtom, "alpha");
        store.set(sidebarSortDirectionAtom, "descending");
        store.set(sidebarThreadLifecyclesAtom, ["draft", "archived"]);
      });
      const trigger = screen.getByRole("button", { name: "Pinned actions" });
      if (compact) fireEvent.click(trigger);
      else await openMenu();
      for (const label of ["Organize", "Sort by", "Filter"]) {
        const page = await screen.findByRole("menuitem", { name: label });
        if (compact) fireEvent.click(page);
        else await openSubmenu(label);
        const reset = await screen.findByRole("menuitem", { name: "Reset to default" });
        expect(reset.getAttribute("aria-disabled")).not.toBe("true");
        if (!compact) {
          const submenu = screen.getByRole("menu", { name: label });
          expect(submenu.classList.contains("w-max")).toBe(true);
          expect(submenu.classList.contains("min-w-28")).toBe(true);
          expect(submenu.classList.contains("max-w-64")).toBe(true);
        }
        fireEvent.click(reset);
        expect(
          screen
            .getByRole("menuitem", { name: "Reset to default" })
            .getAttribute("aria-disabled"),
        ).toBe("true");
        expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
        expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
        expect(store.get(sidebarChronologicalSortAtom)).toBe(
          label === "Organize" ? "alpha" : "updated",
        );
        expect(store.get(sidebarSortDirectionAtom)).toBe(
          label === "Organize" ? "descending" : "default",
        );
        expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(
          label === "Filter" ? ["active"] : ["draft", "archived"],
        );
        if (compact)
          fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
        else fireEvent.keyDown(reset, { key: "ArrowLeft" });
        await waitFor(() =>
          expect(screen.queryByRole("menuitem", { name: "Reset to default" })).toBeNull(),
        );
        await screen.findByRole("menuitem", { name: "New project" });
      }
      expect(
        trigger.querySelector('[data-icon="MoreHorizontal"]'),
      ).toBeTruthy();
      expect(trigger.classList.contains("bg-state-active")).toBe(false);
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

  it("keeps saved environment grouping outside the menu and its reset", async () => {
    const { store } = setup("Pinned", false, "chronological");
    act(() => store.set(sidebarEnvironmentGroupingAtom, true));
    const trigger = screen.getByRole("button", { name: "Pinned actions" });
    expect(trigger.classList.contains("bg-state-active")).toBe(false);
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Organize" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sort by" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Filter" })).toBeTruthy();
    await openSubmenu("Organize");
    expect(screen.queryByRole("group", { name: "Groups" })).toBeNull();
    expect(screen.queryByText("By environment")).toBeNull();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "By project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset to default" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(true);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("toggles sort direction without closing and resets direction for a different field", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Sort by");
    const updated = await screen.findByRole("menuitemradio", {
      name: "Updated at, descending. Sort ascending",
    });
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
