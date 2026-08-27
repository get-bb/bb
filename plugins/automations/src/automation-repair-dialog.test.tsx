// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: () => ({}),
  useBbNavigate: vi.fn(),
  useRealtime: vi.fn(),
  useRpc: vi.fn(),
}));

import { RepairAutomationDialog } from "../app.js";

afterEach(cleanup);

it("collects the missing prompt before repairing an automation", () => {
  const onConfirm = vi.fn();

  function Harness() {
    const [prompt, setPrompt] = useState("");
    return (
      <RepairAutomationDialog
        target={{
          id: "auto_hidden",
          projectId: "proj_test",
          name: "Hidden legacy row",
          problem: "missing-agent-prompt",
        }}
        prompt={prompt}
        pending={false}
        onPromptChange={setPrompt}
        onOpenChange={vi.fn()}
        onConfirm={() => onConfirm(prompt)}
      />
    );
  }

  render(<Harness />);
  expect(screen.getByText("Hidden legacy row", { exact: false })).toBeTruthy();
  const save = screen.getByRole("button", {
    name: "Save prompt",
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Automation prompt"), {
    target: { value: "Review the failed build" },
  });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  expect(onConfirm).toHaveBeenCalledWith("Review the failed build");
});
