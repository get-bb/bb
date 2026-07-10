import { describe, expect, it } from "vitest";
import {
  buildDesktopRailViewModel,
  serverTileInitial,
} from "../src/desktop-rail-view-model.js";
import type { BbDesktopServerListEntry } from "@bb/desktop-contract";

function entry(
  partial: Partial<BbDesktopServerListEntry> &
    Pick<BbDesktopServerListEntry, "id" | "name">,
): BbDesktopServerListEntry {
  return {
    active: false,
    source: "manual",
    status: "unknown",
    url: "https://example.test",
    ...partial,
  };
}

describe("serverTileInitial", () => {
  it("uses the first letter or digit", () => {
    expect(serverTileInitial("This Mac")).toBe("T");
    expect(serverTileInitial("  prod ")).toBe("P");
    expect(serverTileInitial("42-cluster")).toBe("4");
  });

  it("handles empty and non-alphanumeric names", () => {
    expect(serverTileInitial("")).toBe("?");
    expect(serverTileInitial("   ")).toBe("?");
    expect(serverTileInitial("***")).toBe("*");
  });
});

describe("buildDesktopRailViewModel", () => {
  it("maps list entries into rail tiles", () => {
    const model = buildDesktopRailViewModel({
      servers: [
        entry({
          active: true,
          id: "builtin-local",
          name: "This Mac",
          source: "builtin",
          status: "connected",
        }),
        entry({
          id: "remote-1",
          name: "staging",
          status: "offline",
        }),
      ],
    });
    expect(model.servers).toEqual([
      {
        active: true,
        id: "builtin-local",
        initial: "T",
        name: "This Mac",
        source: "builtin",
        status: "connected",
      },
      {
        active: false,
        id: "remote-1",
        initial: "S",
        name: "staging",
        source: "manual",
        status: "offline",
      },
    ]);
  });
});
