// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchPicker } from "./BranchPicker";

afterEach(cleanup);

describe("BranchPicker modality", () => {
  it("keeps the page interactive and closes when focus leaves", async () => {
    render(
      <>
        <BranchPicker value="main" options={["main"]} onChange={vi.fn()} />
        <button type="button">Outside control</button>
      </>,
    );
    const trigger = screen.getByRole("combobox", { name: "Branch" });
    const search = () => screen.queryByPlaceholderText("Search branches");

    fireEvent.click(trigger);
    expect(search()).not.toBeNull();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(getComputedStyle(document.body).pointerEvents).not.toBe("none");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(search()).toBeNull());
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const outside = screen.getByRole("button", { name: "Outside control" });
    outside.focus();
    await waitFor(() => expect(search()).toBeNull());
    expect(document.activeElement).toBe(outside);
  });
});

describe("BranchPicker search", () => {
  it("uses fuzzy matching and returns the results viewport to the top", () => {
    render(
      <BranchPicker
        value="main"
        options={[
          "main",
          "develop",
          "feature/one",
          "feature/two",
          "feature/three",
        ]}
        onChange={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));
    const search = screen.getByPlaceholderText("Search branches");
    const scrollArea = search.parentElement?.parentElement?.nextElementSibling;
    expect(scrollArea).toBeInstanceOf(HTMLElement);
    if (!(scrollArea instanceof HTMLElement)) return;
    scrollArea.scrollTop = 120;

    fireEvent.change(search, { target: { value: "fth" } });

    expect(scrollArea.scrollTop).toBe(0);
    expect(screen.getByText("feature/three")).toBeTruthy();
    expect(screen.queryByText("feature/two")).toBeNull();
  });

  it("uses relevance order instead of pinning the selected match", () => {
    const selectedBranch = "super-feature/three-compatibility";
    const directBranch = "feature/three";
    render(
      <BranchPicker
        value={selectedBranch}
        options={[selectedBranch, directBranch]}
        onChange={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));
    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "fth" },
    });

    const directResult = screen.getByText(directBranch);
    const selectedResult = screen.getAllByText(selectedBranch).at(-1);
    expect(selectedResult).toBeTruthy();
    if (!selectedResult) return;
    expect(
      directResult.compareDocumentPosition(selectedResult) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("keeps an empty result in the branches section", () => {
    render(
      <BranchPicker
        value={null}
        options={[]}
        onChange={vi.fn()}
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));

    expect(screen.getByText("Branches")).toBeTruthy();
    expect(screen.getByText("No branches found.").className).toContain("py-3");
  });
});

describe("BranchPicker keyboard navigation", () => {
  it("moves the highlight with arrow keys and selects it with Enter", () => {
    Element.prototype.scrollIntoView = vi.fn();
    try {
      const onChange = vi.fn();
      render(
        <BranchPicker
          value="origin/main"
          options={["main", "origin/main", "release"]}
          onChange={onChange}
          modal={false}
        />,
      );

      fireEvent.click(screen.getByRole("combobox", { name: "Branch" }));
      const search = screen.getByPlaceholderText("Search branches");
      const row = (name: string) => screen.getByRole("button", { name });
      expect(row("origin/main").hasAttribute("data-highlighted")).toBe(true);

      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(row("origin/main").hasAttribute("data-highlighted")).toBe(false);
      expect(row("release").hasAttribute("data-highlighted")).toBe(true);

      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "ArrowUp" });
      expect(row("main").hasAttribute("data-highlighted")).toBe(true);

      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("main");
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });
});
