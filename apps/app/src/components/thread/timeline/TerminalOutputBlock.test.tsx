// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow";
import { TerminalOutputBlock } from "./TerminalOutputBlock";

afterEach(cleanup);

it("reveals the complete command with the outer timeline row", () => {
  const commandLine = [
    "$ run-task \\",
    "  --first-option alpha \\",
    "  --second-option beta \\",
    "  --third-option gamma",
  ].join("\n");

  render(
    <ExpandableTimelineRow
      title={{
        segments: [],
        decorations: [],
        tone: "default",
        action: null,
        plain: "Ran command",
      }}
      titleContent="Ran command"
      renderBody={() => (
        <TerminalOutputBlock commandLine={commandLine} output="done" />
      )}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Ran command" }));

  const renderedCommand = screen.getByText(
    (_, element) =>
      element?.childNodes.length === 1 && element.textContent === commandLine,
  );
  expect(renderedCommand.closest("button")).toBeNull();
  expect(renderedCommand.className).not.toContain("max-h-[2lh]");
  expect(renderedCommand.style.webkitLineClamp).toBe("");
});
