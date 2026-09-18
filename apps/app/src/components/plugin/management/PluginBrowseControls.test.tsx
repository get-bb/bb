// @vitest-environment jsdom

import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginBrowseCategoryFilter,
  PluginCollectionToolbar,
} from "./PluginBrowseControls";
import type { PluginBrowseCategoryOption } from "./plugin-browse-discovery";

const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewport.compact,
}));

const OPTIONS: PluginBrowseCategoryOption[] = [
  { id: "memory-and-context", label: "Memory & Context", count: 4 },
  { id: "security", label: "Security", count: 2 },
  { id: "tasks-and-workflows", label: "Tasks & Workflows", count: 7 },
];

function openMenu(selectionLabel: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: `Filter plugins by category: ${selectionLabel}`,
    }),
  );
}

afterEach(() => {
  cleanup();
  document.getElementById("toolbar-test-layout")?.remove();
  viewport.compact = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginBrowseCategoryFilter", () => {
  it("shows searchable counts and checkboxes", () => {
    render(
      <PluginBrowseCategoryFilter
        options={OPTIONS}
        value={[]}
        onChange={() => undefined}
      />,
    );
    openMenu("All categories");

    expect(screen.getAllByRole("option")).toHaveLength(3);
    const security = screen.getByRole("option", { name: /Security/u });
    expect(
      security.querySelector("[data-category-option-count]")?.textContent,
    ).toBe("2");
    expect(
      security
        .querySelector("[data-category-option-checkbox]")
        ?.getAttribute("data-state"),
    ).toBe("disabled");
    const search = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    fireEvent.change(search, { target: { value: "work" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain(
      "Tasks & Workflows",
    );
  });

  it("keeps the menu open for multiple selections", () => {
    function Harness() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <PluginBrowseCategoryFilter
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    openMenu("All categories");
    expect(
      screen
        .getByRole("button", { name: "Clear filter" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: /Security/u }));
    fireEvent.click(screen.getByRole("option", { name: /Tasks & Workflows/u }));

    expect(
      screen
        .getByRole("listbox", { name: "Plugin categories" })
        .getAttribute("aria-multiselectable"),
    ).toBe("true");
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: Security, Tasks & Workflows",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(
      screen
        .getByRole("button", { name: "Clear filter" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    ).toBeTruthy();
  });

  it("moves focus through options with the keyboard", () => {
    const onChange = vi.fn();
    render(
      <PluginBrowseCategoryFilter
        options={OPTIONS}
        value={["tasks-and-workflows"]}
        onChange={onChange}
      />,
    );
    openMenu("Tasks & Workflows");
    const search = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Memory & Context");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(document.activeElement?.textContent).toContain("Tasks & Workflows");
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("keeps keyboard focus inside each filter instance", () => {
    render(
      <>
        <PluginBrowseCategoryFilter
          options={OPTIONS}
          value={[]}
          onChange={() => undefined}
        />
        <PluginBrowseCategoryFilter
          options={OPTIONS}
          value={[]}
          onChange={() => undefined}
        />
      </>,
    );
    const triggers = screen.getAllByRole("button", {
      name: "Filter plugins by category: All categories",
    });
    fireEvent.click(triggers[0] as HTMLButtonElement);
    const firstSearch = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    const firstList = screen.getByRole("listbox", {
      name: "Plugin categories",
    });
    expect(firstSearch.getAttribute("aria-controls")).toBe(firstList.id);
    fireEvent.click(triggers[0] as HTMLButtonElement);
    fireEvent.click(triggers[1] as HTMLButtonElement);
    const secondSearch = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    const secondList = screen.getByRole("listbox", {
      name: "Plugin categories",
    });
    expect(secondSearch.getAttribute("aria-controls")).toBe(secondList.id);
    expect(firstList.id).not.toBe(secondList.id);

    fireEvent.keyDown(secondSearch, { key: "ArrowDown" });
    expect(secondList.contains(document.activeElement)).toBe(true);
    expect(firstList.contains(document.activeElement)).toBe(false);
  });
});

function ToolbarHarness({
  installed = false,
  categoryShelf = false,
  createAction = false,
  installsKnown = false,
}: {
  installed?: boolean;
  categoryShelf?: boolean;
  createAction?: boolean;
  installsKnown?: boolean;
}) {
  const [params, setParams] = useState(
    new URLSearchParams(
      "query=Memory&category=security&source=user&sort=name&direction=desc",
    ),
  );
  const sort = params.get("sort");
  const changeSearchParams = (change: (next: URLSearchParams) => void) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      change(next);
      return next;
    });
  };
  return (
    <>
      <PluginCollectionToolbar
        action={
          createAction ? <button type="button">Create</button> : undefined
        }
        query={params.get("query") ?? ""}
        selectedCategories={params.getAll("category")}
        categoryOptions={OPTIONS}
        showCategoryFilter={!categoryShelf}
        sort={
          sort === "name" ||
          sort === "recently-added" ||
          sort === "most-installed"
            ? sort
            : null
        }
        sortDirection={params.get("direction") === "desc" ? "desc" : "asc"}
        installsKnown={installsKnown}
        changeSearchParams={changeSearchParams}
        sourceFilter={
          installed
            ? {
                options: [
                  { id: "user", label: "Local" },
                  { id: "official", label: "BB Official" },
                ],
                selectedValues: params.getAll("source"),
                onChange: (values) =>
                  changeSearchParams((next) => {
                    next.delete("source");
                    values.forEach((value) => next.append("source", value));
                  }),
              }
            : undefined
        }
      />
      <output aria-label="Parameters">{params.toString()}</output>
    </>
  );
}

function mockToolbarWidth(initial: number) {
  let width = initial;
  const callbacks = new Set<() => void>();
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-resource-toolbar"))
        return new DOMRect(0, 0, width, 32);
      if (this.hasAttribute("data-resource-individual-controls"))
        return new DOMRect(
          0,
          0,
          this.querySelectorAll("button").length * 96,
          32,
        );
      if (this.hasAttribute("data-resource-combined-controls"))
        return new DOMRect(0, 0, 112, 32);
      if (this.hasAttribute("data-resource-toolbar-action"))
        return new DOMRect(0, 0, 120, 32);
      return original.call(this);
    },
  );
  const style = document.createElement("style");
  style.id = "toolbar-test-layout";
  style.textContent = `
    [data-resource-toolbar] { column-gap: 8px; }
    [data-resource-toolbar] > div:first-child { flex-basis: 160px; }
  `;
  document.head.append(style);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        if (target.hasAttribute("data-resource-toolbar"))
          callbacks.add(this.callback);
      }
      unobserve() {}
      disconnect() {
        callbacks.delete(this.callback);
      }
    },
  );
  return (next: number) =>
    act(() => {
      width = next;
      callbacks.forEach((callback) => callback());
    });
}

describe("PluginCollectionToolbar", () => {
  it.each([
    { label: "Name", value: "name", direction: "asc" },
    { label: "Published", value: "recently-added", direction: "desc" },
    { label: "Installs", value: "most-installed", direction: "desc" },
  ])(
    "updates the selected $label label and direction without clearing filters",
    ({ label, value, direction }) => {
      mockToolbarWidth(800);
      render(<ToolbarHarness installed installsKnown />);
      const trigger = screen.getByRole("button", { name: /^Sort:/u });
      fireEvent.keyDown(trigger, {
        key: "Enter",
      });
      fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
      expect(screen.getByLabelText("Parameters").textContent).toContain(
        `sort=${value}&direction=${direction}`,
      );
      expect(trigger.textContent).toBe(label);
      expect(screen.getByLabelText("Parameters").textContent).toContain(
        "query=Memory&category=security&source=user",
      );
      fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
      expect(screen.getByLabelText("Parameters").textContent).toContain(
        `direction=${direction === "asc" ? "desc" : "asc"}`,
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Clear sort" }));
      expect(trigger.textContent).toBe("Sort");
    },
  );

  it("shows actual selections and sort direction in the combined menu", () => {
    mockToolbarWidth(320);
    render(<ToolbarHarness installed />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter & sort" }), {
      key: "Enter",
    });
    expect(
      screen.getByRole("menuitem", { name: /Category.*Security/u }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Source.*Local/u }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Sort.*Name · Z–A/u }),
    ).toBeTruthy();
  });

  it("expands cramped search and restores controls on submit or blur without losing the query", () => {
    mockToolbarWidth(320);
    render(<ToolbarHarness installed createAction />);
    const search = screen.getByRole("textbox", { name: "Search plugins" });
    act(() => search.focus());
    expect(
      search
        .closest("[data-resource-toolbar]")
        ?.getAttribute("data-search-expanded"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "Filter & sort" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    fireEvent.change(search, { target: { value: "Notes" } });
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(
      search
        .closest("[data-resource-toolbar]")
        ?.hasAttribute("data-search-expanded"),
    ).toBe(false);
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    expect(screen.getByLabelText("Parameters").textContent).toBe(
      "query=Notes&category=security&source=user&sort=name&direction=desc",
    );
    act(() => search.focus());
    act(() => search.blur());
    expect(screen.getByRole("button", { name: "Filter & sort" })).toBeTruthy();
  });

  it("keeps wide search beside its controls when focused", () => {
    mockToolbarWidth(800);
    render(<ToolbarHarness installed createAction />);
    act(() => screen.getByRole("textbox", { name: "Search plugins" }).focus());
    expect(screen.getByRole("button", { name: /^Sort:/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it.each([
    {
      installed: true,
      categoryShelf: false,
      labels: ["Category", "Source", "Sort"],
    },
    { installed: false, categoryShelf: false, labels: ["Category", "Sort"] },
  ])(
    "preserves the allowed combined controls for %j",
    ({ labels, ...props }) => {
      mockToolbarWidth(320);
      render(<ToolbarHarness {...props} />);
      fireEvent.keyDown(screen.getByRole("button", { name: "Filter & sort" }), {
        key: "Enter",
      });
      expect(
        screen
          .getAllByRole("menuitem")
          .map(
            (item) => item.querySelector("[data-control-page]")?.textContent,
          ),
      ).toEqual(labels);
      expect(screen.queryByRole("button", { name: /^Sort:/u })).toBeNull();
    },
  );

  it("keeps a lone Sort control directly accessible at narrow widths", () => {
    mockToolbarWidth(240);
    render(<ToolbarHarness categoryShelf />);
    expect(screen.getByRole("button", { name: /^Sort:/u }).textContent).toBe(
      "Name",
    );
    expect(screen.queryByRole("button", { name: "Filter & sort" })).toBeNull();
  });

  it("uses the space required by each surface instead of a common viewport cutoff", () => {
    const resize = mockToolbarWidth(400);
    const { rerender } = render(<ToolbarHarness />);
    expect(screen.getByRole("button", { name: /^Sort:/u }).textContent).toBe(
      "Name",
    );
    expect(
      screen.getByRole("button", { name: /^Filter plugins by category:/u })
        .textContent,
    ).toBe("Category1");
    rerender(<ToolbarHarness installed />);
    resize(400);
    expect(screen.getByRole("button", { name: "Filter & sort" })).toBeTruthy();
  });

  it("reserves space for the create action before expanding controls", () => {
    mockToolbarWidth(500);
    render(<ToolbarHarness installed createAction />);
    expect(screen.getByRole("button", { name: "Filter & sort" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("shares sort, category search, and source clearing in the combined menu without resetting other values", async () => {
    mockToolbarWidth(320);
    render(<ToolbarHarness installed />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter & sort" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Sort/u }));
    const sort = screen.getByRole("menuitemradio", { name: "Name" });
    await waitFor(() => expect(document.activeElement).toBe(sort));
    fireEvent.click(sort);
    expect(screen.getByLabelText("Parameters").textContent).toContain(
      "direction=asc",
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: "Installs" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear sort" }));
    expect(screen.getByLabelText("Parameters").textContent).toBe(
      "query=Memory&category=security&source=user",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Back to controls" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: /^Sort/u }),
      ),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /^Category/u }));
    const search = screen.getByRole("combobox", {
      name: "Search plugin categories",
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: "security" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: /Security/u }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByLabelText("Parameters").textContent).toBe(
      "query=Memory&source=user",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Back to controls" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Source/u }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear filter" }));
    expect(screen.getByLabelText("Parameters").textContent).toBe(
      "query=Memory",
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Filter & sort" }),
      ),
    );
  });

  it("restores focus to the category entry in the compact drawer", async () => {
    viewport.compact = true;
    mockToolbarWidth(320);
    render(<ToolbarHarness installed />);
    fireEvent.click(screen.getByRole("button", { name: "Filter & sort" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /^Category/u }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "Search plugin categories" }),
      ),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Back to controls" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: /^Category/u }),
      ),
    );
  });

  it("moves focused controls into the combined menu and back without losing search or selection", () => {
    const resize = mockToolbarWidth(600);
    render(<ToolbarHarness installed />);
    screen.getByRole("button", { name: /^Source:/u }).focus();
    resize(320);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Filter & sort" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), {
      target: { value: "Notes" },
    });
    resize(600);
    expect(screen.queryByRole("button", { name: "Filter & sort" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Source: 1/u })).toBeTruthy();
    expect(
      screen
        .getByRole("textbox", { name: "Search plugins" })
        .getAttribute("value"),
    ).toBe("Notes");
    expect(screen.getByLabelText("Parameters").textContent).toContain(
      "category=security&source=user&sort=name&direction=desc",
    );
  });
});
