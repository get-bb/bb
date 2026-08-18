// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSelector } from "./ProjectSelector";

const projects = [{ id: "proj_test", name: "bb" }];

afterEach(() => {
  cleanup();
});

describe("ProjectSelector", () => {
  it("keeps the chevron while transiently disabled so the row does not shift", () => {
    // Submitting a new thread disables the picker for the length of the
    // request; dropping the chevron there would resize the trigger and shift
    // every control beside it.
    render(
      <ProjectSelector
        projects={projects}
        value="proj_test"
        onChange={vi.fn()}
        disabled
        showChevronWhenDisabled
      />,
    );
    const trigger = screen.getByRole("button", { name: "Project" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(trigger.querySelector("[data-icon='ChevronDown']")).not.toBeNull();
  });

  it("drops the chevron for a permanent lock so the trigger reads as a label", () => {
    render(
      <ProjectSelector
        projects={projects}
        value="proj_test"
        onChange={vi.fn()}
        disabled
      />,
    );
    const trigger = screen.getByRole("button", { name: "Project" });
    expect(trigger.querySelector("[data-icon='ChevronDown']")).toBeNull();
  });
});
