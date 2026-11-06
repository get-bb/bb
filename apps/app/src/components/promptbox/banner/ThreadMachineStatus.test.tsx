// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadMachineStatusBanner } from "./ThreadMachineStatus";

const provider = {
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  description: "Run a machine for development.",
  icon: "Cloud",
  logoUrl: null,
  pluginId: "environment-modal-sandbox",
  inputs: null,
  acceptsEmptyInputs: true,
  supportsSuspend: true,
};

afterEach(() => {
  cleanup();
});

function renderBanner(phase: "suspending" | "suspended" | "resuming") {
  const { container } = render(
    <ThreadMachineStatusBanner
      host={{
        name: "Modal sandbox ugxe6e",
        type: "ephemeral",
        machineProviderId: provider.id,
      }}
      provider={provider}
      phase={phase}
      error={null}
      onResume={() => {}}
    />,
  );
  return {
    markup: container.innerHTML,
    status: screen.getByRole("status"),
    buttons: screen.queryAllByRole("button"),
  };
}

describe("ThreadMachineStatusBanner", () => {
  it("names the paused state generically and keeps the provider icon", () => {
    const { markup, status, buttons } = renderBanner("suspended");

    expect(status.textContent).toBe("Machine is paused");
    expect(status.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(markup).not.toContain("Modal sandbox ugxe6e");
    expect(markup).not.toContain(provider.displayName);
    expect(buttons.map((button) => button.textContent)).toEqual(["Resume"]);
    expect(buttons[0]?.hasAttribute("disabled")).toBe(false);
  });

  it.each([
    ["suspending", "Machine is pausing…"],
    ["resuming", "Machine is resuming…"],
  ] as const)("renders the durable %s phase", (phase, expected) => {
    const { status, buttons } = renderBanner(phase);

    expect(status.textContent).toBe(expected);
    expect(buttons).toEqual([]);
  });
});
