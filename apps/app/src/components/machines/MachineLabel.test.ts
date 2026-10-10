import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { isBuiltinIconName } from "@bb/shared-ui/icon";
import { describe, expect, it } from "vitest";
import { resolveMachineIconProvider } from "./MachineLabel";

describe("resolveMachineIconProvider", () => {
  it("uses a provider fallback, not the laptop glyph or another provider's presentation, when an ephemeral machine's provider is not loaded", () => {
    const provider = resolveMachineIconProvider(
      makeHost({
        name: "Sandbox abc123",
        type: "ephemeral",
        machineProviderId: "modal-sandbox",
      }),
      {
        id: "other-provider",
        displayName: "Other",
        icon: "Cloud",
        logoUrl: null,
      },
    );

    expect(provider).not.toBeNull();
    expect(provider?.id).toBe("modal-sandbox");
    expect(provider?.icon).not.toBe("Cloud");
  });

  it("uses a registered icon for an ephemeral machine whose provider is not loaded", () => {
    const provider = resolveMachineIconProvider(
      makeHost({
        name: "Sandbox ugxe6e",
        type: "ephemeral",
        machineProviderId: "unloaded-provider",
      }),
      undefined,
    );

    expect(provider?.icon).toBe("ComputerCloud");
    expect(isBuiltinIconName(provider?.icon ?? "")).toBe(true);
  });
});
