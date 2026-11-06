// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("keeps the outlined check for a partly selected group", () => {
    render(<Checkbox aria-label="Select all" checked="indeterminate" />);
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });

    expect(checkbox.getAttribute("data-state")).toBe("indeterminate");
    expect(checkbox.className).not.toContain("data-[state=indeterminate]");
    expect(
      checkbox.querySelector("[data-icon]")?.getAttribute("data-icon"),
    ).toBe("Check");
  });
});
