// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTabActions } from "./NewTabFileSearch";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
}));

afterEach(cleanup);

describe("NewTabActions", () => {
  it("keeps a trailing terminal control separate from the terminal action", () => {
    const onSelectHost = vi.fn();
    const onStartTerminal = vi.fn();
    const { container } = render(
      <NewTabActions
        onStartTerminal={onStartTerminal}
        startTerminalTrailing={
          <button type="button" onClick={onSelectHost}>
            Machine
          </button>
        }
      />,
    );

    expect(container.querySelector("button button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Machine" }));
    expect(onSelectHost).toHaveBeenCalledOnce();
    expect(onStartTerminal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));
    expect(onStartTerminal).toHaveBeenCalledOnce();
  });
});
