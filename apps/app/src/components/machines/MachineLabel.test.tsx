// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { MachineLabel } from "./MachineLabel";

describe("MachineLabel", () => {
  it("uses the laptop icon and host name for a persistent machine", () => {
    const { container } = render(
      <MachineLabel host={makeHost({ name: "MacBook Pro" })} />,
    );

    expect(screen.getByText("MacBook Pro")).toBeTruthy();
    expect(container.querySelector('[data-icon="Laptop"]')).not.toBeNull();
  });
});
