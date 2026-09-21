// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TerminalShellOption } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalShellSelector } from "./TerminalShellSelector";

const pwsh: TerminalShellOption = {
  id: "pwsh",
  isDefault: true,
  label: "PowerShell 7",
  path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
};

const gitBash: TerminalShellOption = {
  id: "git-bash",
  isDefault: false,
  label: "Git Bash",
  path: "C:\\Program Files\\Git\\bin\\bash.exe",
};

afterEach(cleanup);

describe("TerminalShellSelector", () => {
  it("stays out of the row when the host offers one shell", () => {
    render(
      <TerminalShellSelector
        defaultShell={pwsh}
        isLoading={false}
        onChange={vi.fn()}
        selectedShellId="pwsh"
        shells={[pwsh]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Shell" })).toBeNull();
  });

  it("shows the default shell while loading and when nothing is picked", () => {
    render(
      <TerminalShellSelector
        defaultShell={pwsh}
        isLoading={false}
        onChange={vi.fn()}
        selectedShellId="__automatic__"
        shells={[pwsh, gitBash]}
      />,
    );

    expect(screen.getByRole("button", { name: "Shell" }).textContent).toBe(
      "PowerShell 7",
    );
  });

  it("lets a user pick another shell", () => {
    const onChange = vi.fn();
    render(
      <TerminalShellSelector
        defaultShell={pwsh}
        isLoading={false}
        onChange={onChange}
        selectedShellId="pwsh"
        shells={[pwsh, gitBash]}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Shell" }), {
      button: 0,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Git Bash/u }));

    expect(onChange).toHaveBeenCalledWith("git-bash");
  });

  it("falls back to the host default for a stale preference", () => {
    render(
      <TerminalShellSelector
        defaultShell={pwsh}
        isLoading={false}
        onChange={vi.fn()}
        selectedShellId="not-installed"
        shells={[pwsh, gitBash]}
      />,
    );

    expect(screen.getByRole("button", { name: "Shell" }).textContent).toBe(
      "PowerShell 7",
    );
  });
});
