// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchPicker } from "./BranchPicker";

afterEach(cleanup);

describe("BranchPicker search scrolling", () => {
  it("returns the results viewport to the top when searching", () => {
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

    fireEvent.change(search, { target: { value: "feature/three" } });

    expect(scrollArea.scrollTop).toBe(0);
  });
});
