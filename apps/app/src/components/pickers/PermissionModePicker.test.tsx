// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionModePicker } from "./PermissionModePicker";
import { expectNonmodalPicker } from "@/test/nonmodal-picker";

const permissionOptions = [
  { value: "accept-edits", label: "Accept Edits" },
  { value: "auto", label: "Approve for me" },
  { value: "full", label: "Full Access", tone: "warning" },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PermissionModePicker", () => {
  it("keeps the page interactive and closes when focus leaves", async () => {
    render(
      <PermissionModePicker
        value="auto"
        options={permissionOptions}
        onChange={vi.fn()}
        supported
      />,
    );
    const trigger = screen.getByRole("button", { name: "Permission mode" });
    await expectNonmodalPicker({
      trigger,
      open: () => fireEvent.keyDown(trigger, { key: "Enter" }),
      content: () => screen.queryByRole("menu"),
    });
  });

  it("can show an effective display override without changing the selected value", () => {
    const onChange = vi.fn();
    render(
      <PermissionModePicker
        value="full"
        options={permissionOptions}
        onChange={onChange}
        supported
        displayOverride={{
          label: "Plan Mode",
          compactLabel: "Plan",
          description:
            "Claude Code will plan without normal full-access execution.",
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Permission mode" });
    expect(trigger.textContent).toContain("Plan Mode");
    expect(trigger.textContent).not.toContain("Full Access");
  });
});
