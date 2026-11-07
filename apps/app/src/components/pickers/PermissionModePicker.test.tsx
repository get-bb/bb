// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionModePicker } from "./PermissionModePicker";

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
  it("opens without locking the page behind it", () => {
    render(
      <>
        <PermissionModePicker
          value="full"
          options={permissionOptions}
          onChange={() => {}}
          supported
        />
        <button type="button">Outside control</button>
      </>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Permission mode" }), {
      key: "Enter",
    });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(
      screen.getByRole("button", { name: "Outside control" }),
    ).toBeTruthy();
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
