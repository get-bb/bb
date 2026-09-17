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
}: {
  installed?: boolean;
  categoryShelf?: boolean;
}) {
  const [params, setParams] = useState(
    new URLSearchParams(
      "query=Memory&category=security&source=user&sort=name&direction=desc",
    ),
  );
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
        query={params.get("query") ?? ""}
        selectedCategories={params.getAll("category")}
        categoryOptions={OPTIONS}
        showCategoryFilter={!categoryShelf}
        sort={params.has("sort") ? "name" : null}
        sortDirection={params.get("direction") === "desc" ? "desc" : "asc"}
        installsKnown={false}
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
    function () {
      if (this.hasAttribute("data-resource-toolbar"))
        return new DOMRect(0, 0, width, 32);
      return original.call(this);
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
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
    {
      installed: true,
      categoryShelf: false,
      labels: ["Sort by", "Category", "Source"],
    },
    { installed: false, categoryShelf: false, labels: ["Sort by", "Category"] },
    { installed: false, categoryShelf: true, labels: ["Sort by"] },
  ])(
    "preserves the allowed overflow controls for %j",
    ({ labels, ...props }) => {
      mockToolbarWidth(320);
      render(<ToolbarHarness {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Plugin controls" }));
      expect(
        screen
          .getAllByRole("menuitem")
          .map((item) => item.textContent?.replace("Active", "")),
      ).toEqual(labels);
      expect(screen.queryByRole("button", { name: /^Sort:/u })).toBeNull();
    },
  );

  it("shares sort, category search, and source clearing in overflow without resetting other values", async () => {
    mockToolbarWidth(320);
    render(<ToolbarHarness installed />);
    fireEvent.click(screen.getByRole("button", { name: "Plugin controls" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Sort by/u }));
    const sort = screen.getByRole("menuitemradio", { name: "Plugin name" });
    await waitFor(() => expect(document.activeElement).toBe(sort));
    fireEvent.click(sort);
    expect(screen.getByLabelText("Parameters").textContent).toContain(
      "direction=asc",
    );
    expect(
      screen
        .getByRole("menuitemradio", { name: "Most installed" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear sort" }));
    expect(screen.getByLabelText("Parameters").textContent).toBe(
      "query=Memory&category=security&source=user",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Back to controls" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "Sort by" }),
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
        screen.getByRole("button", { name: "Plugin controls" }),
      ),
    );
  });

  it("moves focused controls into overflow and back without losing search or selection", () => {
    const resize = mockToolbarWidth(600);
    render(<ToolbarHarness installed />);
    screen.getByRole("button", { name: /^Source:/u }).focus();
    resize(320);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Plugin controls" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), {
      target: { value: "Notes" },
    });
    resize(600);
    expect(
      screen.queryByRole("button", { name: "Plugin controls" }),
    ).toBeNull();
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
