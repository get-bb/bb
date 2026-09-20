// @vitest-environment jsdom

import {
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
  sidebarSortGroupsByRecencyAtom,
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
  fireEvent.keyDown(screen.getByRole("button", { name: `${label} actions` }), {
    key: "Enter",
  });
  await screen.findByRole("menuitem", { name: "New project" });
}

async function openSubmenu(label: string) {
  fireEvent.keyDown(screen.getByRole("menuitem", { name: label }), {
    key: "ArrowRight",
  });
}

describe("sidebar header controls", () => {
  it("keeps the primary before overflow and applies the shared control state", async () => {
    const { newThread } = setup();
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

  it("resolves auto grouping from the organization mode and pins an explicit choice", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Organize");
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "By environment",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "By environment" })
          .getAttribute("aria-checked"),
      ).toBe("false"),
    );

    store.set(sidebarOrganizationModeAtom, "chronological");
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "By environment" })
          .getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });

  it("leaves auto grouping off in Custom and on in the other modes", async () => {
    const { store } = setup("Pinned", false, "chronological");
    await openMenu();
    await openSubmenu("Organize");
    expect(
      (
        await screen.findByRole("menuitemcheckbox", { name: "By environment" })
      ).getAttribute("aria-checked"),
    ).toBe("false");

    store.set(sidebarOrganizationModeAtom, "machine");
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "By environment" })
          .getAttribute("aria-checked"),
      ).toBe("true"),
    );
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe("auto");
  });

  it("preserves Updated at direction toggling", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Sort by");
    fireEvent.click(
      screen.getByRole("menuitemradio", {
        name: "Updated at, descending. Sort ascending",
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitemradio", {
        name: "Updated at, ascending. Sort descending",
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("descending");
  });

  it.each([
    ["project", "projects"],
    ["machine", "machines"],
    ["chronological", "sections"],
  ] as const)("names the extra sorting scope in %s mode", async (mode, unit) => {
    const { store } = setup("Pinned", false, mode);
    await openMenu();
    await openSubmenu("Sort by");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Alphabetical" }));
    const option = await screen.findByRole("menuitemradio", {
      name: `Updated at (include ${unit})`,
    });
    expect(option.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(option);
    expect(store.get(sidebarChronologicalSortAtom)).toBe("updated");
    expect(store.get(sidebarSortDirectionAtom)).toBe("descending");
    expect(store.get(sidebarSortGroupsByRecencyAtom)).toBe(true);
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("menuitemradio", { name: "Updated at" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.click(option);
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    expect(store.get(sidebarSortGroupsByRecencyAtom)).toBe(true);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Updated at" }));
    expect(store.get(sidebarSortGroupsByRecencyAtom)).toBe(false);
    expect(option.getAttribute("aria-checked")).toBe("false");
  });

  it("offers both Updated at choices in the compact sort menu and resets after closing", async () => {
    viewport.compact = true;
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pinned actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sort by" }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /Updated at\s*, descending\. Sort ascending/,
      }),
    );
    expect(store.get(sidebarSortDirectionAtom)).toBe("ascending");
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Updated at (include projects)" }),
    );
    expect(store.get(sidebarSortGroupsByRecencyAtom)).toBe(true);
    expect(
      screen.getByRole("menuitemradio", {
        name: /Updated at \(include projects\)\s*, descending\. Sort ascending/,
      }),
    ).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Organize" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom" }));
    expect(store.get(sidebarOrganizationModeAtom)).toBe("chronological");
    expect(
      screen
        .getByRole("menuitemradio", { name: "Custom" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Pinned actions" }));
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pinned actions" }));
    expect(
      await screen.findByRole("menuitem", { name: "New project" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull();
  });
});
