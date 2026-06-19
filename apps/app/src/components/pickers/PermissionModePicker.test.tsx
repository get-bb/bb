// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionModePicker } from "./PermissionModePicker";

const permissionOptions = [
  { value: "full", label: "Full Access", tone: "warning" },
  { value: "workspace-write", label: "Workspace Write" },
  { value: "readonly", label: "Readonly" },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PermissionModePicker", () => {
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
    expect(trigger.className).not.toContain("text-warning-text");
    expect(trigger.getAttribute("title")).toBe(
      "Permission mode: Plan Mode - Claude Code will plan without normal full-access execution.",
    );
  });

  it("can keep the chevron visible while disabled", () => {
    render(
      <PermissionModePicker
        value="full"
        options={permissionOptions}
        onChange={vi.fn()}
        supported
        disabled
        showChevronWhenDisabled
        displayOverride={{
          label: "Plan Mode",
          compactLabel: "Plan",
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Permission mode" });
    expect(trigger).toHaveProperty("disabled", true);
    expect(trigger.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
  });
});
