// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectCreateDetailsDialog } from "./ProjectCreateDetailsDialog";

const target = {
  path: "/home/deploy/repos/givecare",
  hostId: "host_atum",
  hostName: "atum",
  suggestedName: "givecare",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectCreateDetailsDialog", () => {
  it("prefills the name and shows read-only path and machine rows", () => {
    render(
      <ProjectCreateDetailsDialog
        target={target}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(
      (screen.getByLabelText("Project name") as HTMLInputElement).value,
    ).toBe("givecare");
    expect(screen.getByText(target.path)).toBeDefined();
    expect(screen.getByText("atum")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Back" })).toBeDefined();
  });

  it("confirms with the edited trimmed name on submit", () => {
    const onConfirm = vi.fn();
    render(
      <ProjectCreateDetailsDialog
        target={target}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "  My Project  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onConfirm).toHaveBeenCalledWith("My Project");
  });

  it("blocks confirm until the name is non-empty", () => {
    const onConfirm = vi.fn();
    render(
      <ProjectCreateDetailsDialog
        target={{ ...target, suggestedName: "" }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Project name cannot be empty.")).toBeDefined();
  });

  it("returns to path picking via Back", () => {
    const onBack = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ProjectCreateDetailsDialog
        target={target}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        onBack={onBack}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables inputs while creation is pending", () => {
    render(
      <ProjectCreateDetailsDialog
        target={target}
        pending
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Project name").hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Create project" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Back" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
