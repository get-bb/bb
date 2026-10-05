// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoList } from "./info-list";

function renderList(count: number) {
  const items = Array.from({ length: count }, (_, index) => `item-${index}`);
  render(
    <InfoList
      items={items}
      getKey={(item) => item}
      renderItem={(item) => <li>{item}</li>}
    />,
  );
}

afterEach(cleanup);

describe("InfoList", () => {
  it("shows every item instead of a toggle that would reveal only one more", () => {
    renderList(6);
    expect(screen.getAllByText(/^item-/)).toHaveLength(6);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("collapses past the limit and expands to every item", () => {
    renderList(8);
    expect(screen.getAllByText(/^item-/)).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(screen.getAllByText(/^item-/)).toHaveLength(8);
    expect(
      screen
        .getByRole("button", { name: "Show less" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
