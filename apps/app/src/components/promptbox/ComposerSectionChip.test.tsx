// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerSectionChip } from "./ComposerSectionChip";

const SECTIONS = [
  { id: "sec_client", name: "Client Work" },
  { id: "sec_research", name: "Research" },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ComposerSectionChip", () => {
  it("names the unsectioned destination when nothing is selected", () => {
    render(
      <ComposerSectionChip
        sections={SECTIONS}
        value={null}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Section: Threads" }),
    ).not.toBeNull();
  });

  it("names the selected section so the destination is visible before submitting", () => {
    render(
      <ComposerSectionChip
        sections={SECTIONS}
        value="sec_research"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Section: Research" }),
    ).not.toBeNull();
  });

  it("falls back to the unsectioned label when the selected section no longer exists", () => {
    render(
      <ComposerSectionChip
        sections={SECTIONS}
        value="sec_deleted"
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Section: Threads" }),
    ).not.toBeNull();
  });

  it("reports the chosen section id", () => {
    const onChange = vi.fn();
    render(
      <ComposerSectionChip
        sections={SECTIONS}
        value={null}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Section: Threads" }));
    fireEvent.click(screen.getByRole("option", { name: "Client Work" }));

    expect(onChange).toHaveBeenCalledWith("sec_client");
  });

  it("reports a null destination when the unsectioned entry is chosen", () => {
    const onChange = vi.fn();
    render(
      <ComposerSectionChip
        sections={SECTIONS}
        value="sec_client"
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Section: Client Work" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Threads" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("marks only the selected destination as current", () => {
    render(
      <ComposerSectionChip
        sections={SECTIONS}
        value="sec_research"
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Section: Research" }));

    expect(
      screen
        .getByRole("option", { name: "Research" })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "Client Work" })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen
        .getByRole("option", { name: "Threads" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });
});
