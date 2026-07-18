import { describe, expect, it } from "vitest";
import { resolvePermissionModeSelection } from "./useThreadCreationOptions";

describe("resolvePermissionModeSelection", () => {
  it("chooses the raw permission mode when supported", () => {
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "accept-edits",
        supportedPermissionModes: ["accept-edits", "auto", "full"],
      }),
    ).toBe("accept-edits");
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "full",
        supportedPermissionModes: ["accept-edits", "full"],
      }),
    ).toBe("full");
  });

  it("falls back to full when auto is unsupported", () => {
    // ACP advertises accept-edits/full only. Full is the product fallback when
    // the provider has no native automatic reviewer.
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "auto",
        supportedPermissionModes: ["accept-edits", "full"],
      }),
    ).toBe("full");
  });

  it("prefers the auto default when the raw mode is unsupported", () => {
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "accept-edits",
        supportedPermissionModes: ["auto", "full"],
      }),
    ).toBe("auto");
  });

  it("uses the only supported mode for full-only providers", () => {
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "accept-edits",
        supportedPermissionModes: ["full"],
      }),
    ).toBe("full");
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "accept-edits",
        supportedPermissionModes: [],
      }),
    ).toBe("auto");
  });
});
