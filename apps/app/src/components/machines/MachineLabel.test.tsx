// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { MachineLabel } from "./MachineLabel";

const modalProvider = {
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  icon: "Cloud",
  logoUrl: null,
};

describe("MachineLabel", () => {
  it("uses the laptop icon and host name for a persistent machine", () => {
    const { container } = render(
      <MachineLabel host={makeHost({ name: "MacBook Pro" })} />,
    );

    expect(screen.getByText("MacBook Pro")).toBeTruthy();
    expect(container.querySelector('[data-icon="Laptop"]')).not.toBeNull();
  });

  it("uses the provider icon and only the host name for an ephemeral machine", () => {
    const { container } = render(
      <MachineLabel
        host={makeHost({
          name: "Modal sandbox ugxe6e",
          type: "ephemeral",
          machineProviderId: modalProvider.id,
        })}
        machineProvider={modalProvider}
      />,
    );

    expect(screen.getByText("Modal sandbox ugxe6e")).toBeTruthy();
    expect(screen.queryByText(modalProvider.displayName)).toBeNull();
    expect(container.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Laptop"]')).toBeNull();
  });
});
