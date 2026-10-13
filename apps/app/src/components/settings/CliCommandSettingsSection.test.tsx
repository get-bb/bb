// @vitest-environment jsdom

import type { SystemCliCommandStatus } from "@bb/server-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CliCommandSettingsSectionContent } from "./CliCommandSettingsSection";

afterEach(() => {
  cleanup();
});

const NOT_INSTALLED: SystemCliCommandStatus = {
  installedPath: null,
  onPath: false,
  shadowedBy: null,
  supported: true,
};

function renderSection(
  status: SystemCliCommandStatus,
  pending = false,
): ("install" | "remove")[] {
  const changes: ("install" | "remove")[] = [];
  render(
    <CliCommandSettingsSectionContent
      status={status}
      pending={pending}
      onChange={(change) => changes.push(change)}
    />,
  );
  return changes;
}

function button(name: string): HTMLButtonElement {
  const element = screen.getByRole("button", { name });
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`${name} is not a button`);
  }
  return element;
}

describe("CliCommandSettingsSectionContent", () => {
  it("installs the command when it is not on PATH", () => {
    const changes = renderSection(NOT_INSTALLED);

    fireEvent.click(button("Install bb CLI"));

    expect(changes).toEqual(["install"]);
  });

  it("removes the command it installed and says where it is", () => {
    const changes = renderSection({
      ...NOT_INSTALLED,
      installedPath: "/home/me/.local/bin/bb",
      onPath: true,
    });

    expect(
      screen.getByText(
        "Installed at /home/me/.local/bin/bb. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex.",
      ),
    ).toBeDefined();
    fireEvent.click(button("Remove bb CLI"));

    expect(changes).toEqual(["remove"]);
  });

  it("says which folder is missing from PATH after installing off PATH", () => {
    renderSection({
      ...NOT_INSTALLED,
      installedPath: "/home/me/.local/bin/bb",
    });

    expect(
      screen.getByText(
        "Installed at /home/me/.local/bin/bb, but its folder is not on your PATH. Add the folder to your PATH to use bb outside bb.",
      ),
    ).toBeDefined();
  });

  it("does not offer to install behind another bb that runs first", () => {
    renderSection({
      ...NOT_INSTALLED,
      shadowedBy: { path: "/usr/local/bin/bb", source: "other" },
    });

    expect(button("Install bb CLI").disabled).toBe(true);
    expect(
      screen.getByText(
        "Another bb at /usr/local/bin/bb comes first on your PATH. Remove it to install this one.",
      ),
    ).toBeDefined();
  });

  it("recognises a bb that npm already put on PATH", () => {
    renderSection({
      ...NOT_INSTALLED,
      shadowedBy: { path: "/usr/local/bin/bb", source: "npm" },
    });

    expect(button("Install bb CLI").disabled).toBe(true);
    expect(
      screen.getByText(
        "Already installed for use outside bb at /usr/local/bin/bb, by npm.",
      ),
    ).toBeDefined();
  });

  it("blocks a second change while one is running", () => {
    renderSection(NOT_INSTALLED, true);

    expect(button("Install bb CLI").disabled).toBe(true);
  });
});
