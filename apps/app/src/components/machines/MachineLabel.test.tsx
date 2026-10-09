// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { MachineLabel } from "./MachineLabel";

describe("MachineLabel", () => {
  it("shows a provider fallback, not the laptop glyph or another provider's icon, when an ephemeral machine's provider is not loaded", () => {
    const { container } = render(
      <MachineLabel
        host={makeHost({
          name: "Sandbox abc123",
          type: "ephemeral",
          machineProviderId: "modal-sandbox",
        })}
        machineProvider={{
          id: "other-provider",
          displayName: "Other",
          icon: "Cloud",
          logoUrl: null,
        }}
      />,
    );

    const icon = container.querySelector("[data-icon]");
    expect(screen.getByText("Sandbox abc123")).toBeTruthy();
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-icon")).not.toBe("Laptop");
    expect(icon?.getAttribute("data-icon")).not.toBe("Cloud");
  });

  it("uses a registered icon for an ephemeral machine whose provider is not loaded", () => {
    const { container } = render(
      <MachineLabel
        host={makeHost({
          name: "Sandbox ugxe6e",
          type: "ephemeral",
          machineProviderId: "unloaded-provider",
        })}
      />,
    );

    expect(
      container.querySelector('[data-icon="ComputerCloud"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-icon="Zap"]')).toBeNull();
  });
});
