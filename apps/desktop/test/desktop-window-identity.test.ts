import { describe, expect, it } from "vitest";
import { createDesktopWindowIdentityRegistry } from "../src/desktop-window-identity.js";

describe("desktop window identity registry", () => {
  it("issues one stable identity per window and never shares it across windows", () => {
    const registry = createDesktopWindowIdentityRegistry();

    const first = registry.identityFor(11);
    const second = registry.identityFor(12);

    expect(first.windowId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(registry.identityFor(11)).toEqual(first);
    expect(second.windowId).not.toBe(first.windowId);
  });

  it("forgets released windows so a reused web contents id gets a fresh identity", () => {
    let counter = 0;
    const registry = createDesktopWindowIdentityRegistry({
      createWindowId: () => `window-${(counter += 1)}`,
    });

    expect(registry.identityFor(7)).toEqual({ windowId: "window-1" });
    registry.release(7);
    expect(registry.identityFor(7)).toEqual({ windowId: "window-2" });
  });
});
