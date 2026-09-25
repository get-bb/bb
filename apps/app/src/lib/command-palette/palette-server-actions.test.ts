import { describe, expect, it, vi } from "vitest";
import { buildServerPaletteActions } from "./palette-server-actions";

describe("buildServerPaletteActions", () => {
  it("offers every other server", () => {
    const select = vi.fn();
    const actions = buildServerPaletteActions({
      select,
      servers: [
        { active: true, id: "builtin", kind: "builtin", name: "This Mac" },
        { active: false, id: "custom:ops", kind: "custom", name: "ops" },
        { active: false, id: "connect:box", kind: "connect", name: "Box" },
      ],
    });

    expect(actions.map((action) => [action.id, action.title])).toEqual([
      ["server:custom:ops", "Switch to server: ops"],
      ["server:connect:box", "Switch to server: Box"],
    ]);
    actions[0]?.run();
    expect(select).toHaveBeenCalledExactlyOnceWith("custom:ops");
  });

  it("adds nothing outside the desktop app", () => {
    expect(buildServerPaletteActions(null)).toEqual([]);
  });
});
