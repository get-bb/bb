import { describe, expect, it } from "vitest";
import type { MachineSummary } from "@/server/api";
import { deviceStatus, deviceTitle, splitUnused } from "./dashboard-groups";

function device(
  id: string,
  overrides: Partial<MachineSummary> = {},
): MachineSummary {
  return {
    id,
    name: null,
    kind: null,
    subdomain: null,
    online: false,
    lastSeenAt: null,
    unused: false,
    createdAt: 0,
    ...overrides,
  };
}

describe("dashboard devices", () => {
  it("folds unused devices away from the ones in use", () => {
    const groups = splitUnused([
      device("phone"),
      device("old-phone", { unused: true }),
      device("laptop"),
    ]);
    expect(groups.devices.map((d) => d.id)).toEqual(["phone", "laptop"]);
    expect(groups.unusedDevices.map((d) => d.id)).toEqual(["old-phone"]);
  });

  it("names unnamed devices by kind instead of an id", () => {
    expect(deviceTitle(device("a", { kind: "desktop" }))).toBe("Desktop app");
    expect(deviceTitle(device("b", { subdomain: "box" }))).toBe("Remote host");
    expect(deviceTitle(device("c"))).toBe("Unnamed device");
    expect(deviceTitle(device("d", { name: "iPhone", kind: "mobile" }))).toBe(
      "iPhone",
    );
  });

  it("shows when a device was last used to the day", () => {
    const now = new Date(2026, 10, 6, 9, 0).getTime();
    const at = (day: number, hour: number) =>
      new Date(2026, 10, day, hour).getTime();
    expect(deviceStatus(device("a"), now)).toBe("Not used yet");
    expect(
      deviceStatus(device("b", { online: true, lastSeenAt: at(1, 9) }), now),
    ).toBe("Online");
    expect(deviceStatus(device("c", { lastSeenAt: at(6, 0) }), now)).toBe(
      "Today",
    );
    expect(deviceStatus(device("d", { lastSeenAt: at(5, 23) }), now)).toBe(
      "Yesterday",
    );
    expect(deviceStatus(device("e", { lastSeenAt: at(3, 10) }), now)).toBe(
      "3 days ago",
    );
  });
});
