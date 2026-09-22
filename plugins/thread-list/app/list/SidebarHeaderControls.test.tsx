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
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { SIDEBAR_CONTROL_STATE_CLASS } from "../rows/sidebarRowClasses.js";
import {
  sidebarThreadLifecyclesAtom,
  sidebarChronologicalSortAtom,
  sidebarOrganizationModeAtom,
  sidebarEnvironmentGroupingAtom,
  sidebarProviderIconColorAtom,
  sidebarShowProviderIconsAtom,
  sidebarSortDirectionAtom,
} from "../preferences/atoms.js";
import { providerIconColorsDialogOpenAtom } from "./ProviderIconColorsDialog.js";
import type { OrganizationMode } from "../../shared/preferences.js";

installTestPluginRuntime();
const {
  SidebarHeaderActionsProvider,
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} = await import("./SidebarHeaderControls.js");

afterEach(() => {
  cleanup();
});

function setup(
  label = "Pinned",
  section = false,
  organization: OrganizationMode = "project",
  compact = false,
) {
  const store = createStore();
  store.set(sidebarThreadLifecyclesAtom, ["active"]);
  store.set(sidebarOrganizationModeAtom, organization);
  store.set(sidebarChronologicalSortAtom, "updated");
  store.set(sidebarSortDirectionAtom, "default");
  store.set(sidebarEnvironmentGroupingAtom, "auto");
  store.set(sidebarShowProviderIconsAtom, true);
  store.set(sidebarProviderIconColorAtom, "brand");
  const newThread = vi.fn();
  const newSection = vi.fn();
  render(
    <Provider store={store}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <TooltipProvider>
          <SidebarHeaderActionsProvider value={{ onNewSection: newSection }}>
            <SidebarHeaderControls label={label} onNewThread={newThread}>
              {section && (
                <SidebarSectionMenuItems
                  onRename={vi.fn()}
                  onRemove={vi.fn()}
                />
              )}
            </SidebarHeaderControls>
          </SidebarHeaderActionsProvider>
        </TooltipProvider>
      </CompactViewportOverrideProvider>
    </Provider>,
  );
  return { store, newThread, newSection };
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
  await screen.findByRole("menuitem", { name: "New section" });
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
    const newSection = screen.getByRole("menuitem", { name: "New section" });
    fireEvent.keyDown(newSection.closest('[role="menu"]')!, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(newSection));
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
        screen.queryByRole("menuitem", { name: "New section" }),
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
    ).toEqual(["New section", "Organize", "Sort by", "Filter", "Rename", "Remove"]);
    expect(screen.getAllByRole("separator")).toHaveLength(3);
    fireEvent.click(screen.getByRole("menuitem", { name: "New section" }));
    expect(newSection).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "New section" }),
      ).toBeNull(),
    );
  });

  it("disables New section without a creation handler", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TooltipProvider>
          <SidebarHeaderControls label="Pinned" onNewThread={vi.fn()} />
        </TooltipProvider>
      </Provider>,
    );
    await openMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "New section" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
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

  it("preserves the existing Organize groups without a Reset action", async () => {
    const { store } = setup("Pinned", false, "chronological");
    act(() => store.set(sidebarEnvironmentGroupingAtom, true));
    await openMenu();
    await openSubmenu("Organize");
    const grouping = await screen.findByRole("menuitemcheckbox", {
      name: "By environment",
    });
    expect(screen.getByRole("group", { name: "Groups" })).toBeTruthy();
    expect(grouping.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(grouping);
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "By project" }),
    );
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
    expect(store.get(sidebarEnvironmentGroupingAtom)).toBe(false);
    expect(screen.queryByRole("menuitem", { name: /^Reset/ })).toBeNull();
  });

  it("turns provider icons off and back on from Organize", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Organize");
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "Provider icons",
    });
    expect(screen.getByRole("group", { name: "Rows" })).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(store.get(sidebarShowProviderIconsAtom)).toBe(false);
    await waitFor(() =>
      expect(
        screen
          .getByRole("menuitemcheckbox", { name: "Provider icons" })
          .getAttribute("aria-checked"),
      ).toBe("false"),
    );

    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Provider icons" }),
    );
    expect(store.get(sidebarShowProviderIconsAtom)).toBe(true);
  });

  it("switches provider icon colors and opens the color customizer", async () => {
    const { store } = setup();
    await openMenu();
    await openSubmenu("Organize");
    const monochrome = await screen.findByRole("menuitemradio", {
      name: "Monochrome",
    });
    expect(
      screen
        .getByRole("menuitemradio", { name: "Brand colors" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(monochrome);
    expect(store.get(sidebarProviderIconColorAtom)).toBe("monochrome");

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Customize colors…" }),
    );
    expect(store.get(providerIconColorsDialogOpenAtom)).toBe(true);
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
    const { store } = setup("Pinned", false, "project", true);
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
      await screen.findByRole("menuitem", { name: "New section" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull();
  });
});

it.each([false, true])(
  "keeps at least one lifecycle selected in the filter (compact=%s)",
  async (compact) => {
    const { store } = setup("Pinned", false, "project", compact);
    if (compact) {
      fireEvent.click(screen.getByRole("button", { name: /^Pinned actions(?:;|$)/ }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Filter" }));
    } else {
      await openMenu();
      await openSubmenu("Filter");
    }
    const active = await screen.findByRole("menuitemcheckbox", {
      name: "Active",
    });
    fireEvent.click(active);
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["active"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Archived" }));
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual([
      "active",
      "archived",
    ]);
    fireEvent.click(active);
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["archived"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Archived" }));
    expect(store.get(sidebarThreadLifecyclesAtom)).toEqual(["archived"]);
  },
);
