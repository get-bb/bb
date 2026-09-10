// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineLaunchCommand } from "./AddMachineDialog";

const COMMAND =
  "curl -fsSL -H 'X-BB-Enrollment: secret' https://bb/install.sh | sh";

describe("MachineLaunchCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("counts the remaining time down while the command is still valid", () => {
    render(
      <MachineLaunchCommand
        command={COMMAND}
        expiresAt={15 * 60_000}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Command expires in 15:00",
    );
    act(() => void vi.advanceTimersByTime(61_000));
    expect(screen.getByRole("status").textContent).toBe(
      "Command expires in 13:59",
    );
    expect(screen.getByText(COMMAND)).toBeTruthy();
  });

  it("stops offering a copy and offers a replacement once it expires", () => {
    const onRegenerate = vi.fn();
    render(
      <MachineLaunchCommand
        command={COMMAND}
        expiresAt={5_000}
        onRegenerate={onRegenerate}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Copy" }).hasAttribute("disabled"),
    ).toBe(false);
    act(() => void vi.advanceTimersByTime(6_000));
    expect(screen.getByRole("status").textContent).toBe("Command expired");
    expect(
      screen.getByRole("button", { name: "Copy" }).hasAttribute("disabled"),
    ).toBe(true);
    screen.getByRole("button", { name: "Generate a new command" }).click();
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
