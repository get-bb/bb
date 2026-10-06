// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoList, InfoSection } from "./info-list";

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

function CollapsibleSection() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <InfoSection
      label="Commits"
      count={2}
      collapse={{ collapsed, setCollapsed }}
      trailing={<button type="button">Search</button>}
    >
      <p>section body</p>
    </InfoSection>
  );
}

describe("InfoSection", () => {
  it("collapses its body and heading controls from the heading", () => {
    render(<CollapsibleSection />);
    const toggle = screen.getByRole("button", { name: /Commits/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("section body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText("section body")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
  });
});
