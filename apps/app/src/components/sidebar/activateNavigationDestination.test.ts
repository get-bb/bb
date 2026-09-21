// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateNavigationDestination } from "./activateNavigationDestination";

const desktop = vi.hoisted(() => ({ active: false }));
vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => (desktop.active ? { platform: "macos" } : null),
}));

afterEach(() => {
  desktop.active = false;
  vi.restoreAllMocks();
});

describe("sidebar navigation destinations", () => {
  it.each(["metaKey", "ctrlKey"] as const)(
    "opens a browser tab with %s without changing the current route or layout",
    (modifier) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const navigate = vi.fn();
      const openInSplit = vi.fn();
      activateNavigationDestination({
        event: { metaKey: false, ctrlKey: false, [modifier]: true },
        path: "/plugins/docs/main",
        navigate,
        openInSplit,
      });
      expect(open).toHaveBeenCalledWith(
        "/plugins/docs/main",
        "_blank",
        "noopener",
      );
      expect(navigate).not.toHaveBeenCalled();
      expect(openInSplit).not.toHaveBeenCalled();
    },
  );

  it("opens a desktop split without opening a browser tab", () => {
    desktop.active = true;
    const open = vi.spyOn(window, "open");
    const navigate = vi.fn();
    const openInSplit = vi.fn();
    activateNavigationDestination({
      event: { metaKey: true, ctrlKey: false },
      path: "/skills",
      navigate,
      openInSplit,
    });
    expect(openInSplit).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps plain clicks in the current view", () => {
    const navigate = vi.fn();
    const openInSplit = vi.fn();
    activateNavigationDestination({
      event: { metaKey: false, ctrlKey: false },
      path: "/plugins",
      navigate,
      openInSplit,
    });
    expect(navigate).toHaveBeenCalledOnce();
    expect(openInSplit).not.toHaveBeenCalled();
  });
});
