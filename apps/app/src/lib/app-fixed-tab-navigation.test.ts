import { describe, expect, it, vi } from "vitest";
import { openAppFixedTabFromDestinations } from "./app-fixed-tab-navigation";

describe("openAppFixedTabFromDestinations", () => {
  it("resolves an owner-scoped reference and forwards the target unchanged", () => {
    const open = vi.fn(() => true);
    const target = { kind: "record", recordId: "issue-42" } as const;

    expect(
      openAppFixedTabFromDestinations(
        [
          {
            tab: { ownerId: "plugin:demo", tabId: "details" },
            open,
          },
        ],
        {
          surface: { kind: "current" },
          tab: { ownerId: "plugin:demo", tabId: "details" },
          target,
        },
      ),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith(target);
  });

  it("leaves destinations untouched when owner or tab is ineligible", () => {
    const open = vi.fn(() => true);
    expect(
      openAppFixedTabFromDestinations(
        [
          {
            tab: { ownerId: "plugin:other", tabId: "details" },
            open,
          },
        ],
        {
          surface: { kind: "current" },
          tab: { ownerId: "plugin:demo", tabId: "details" },
        },
      ),
    ).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
