import type { Host } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  countProjectsByHost,
  formatRelativeAge,
  machineHeaderMeta,
  machineMetaLine,
} from "./host-display";

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "h1",
    name: "mbp",
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastSeenAt: NOW - 5 * 60_000,
    lastRejectedProtocolVersion: null,
    createdAt: NOW - 3 * 24 * 60 * 60_000,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("formatRelativeAge", () => {
  it("reads like the web relative-time helper", () => {
    expect(formatRelativeAge(NOW + 5_000, NOW)).toBe("just now");
    expect(formatRelativeAge(NOW - 30_000, NOW)).toBe("just now");
    expect(formatRelativeAge(NOW - 2 * 60_000, NOW)).toBe("2m ago");
    expect(formatRelativeAge(NOW - 3 * 60 * 60_000, NOW)).toBe("3h ago");
    expect(formatRelativeAge(NOW - 24 * 60 * 60_000, NOW)).toBe("Yesterday");
    expect(formatRelativeAge(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3d ago");
    expect(formatRelativeAge(NOW - 14 * 24 * 60 * 60_000, NOW)).toBe("2w ago");
    expect(formatRelativeAge(NOW - 60 * 24 * 60 * 60_000, NOW)).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}$/u,
    );
  });
});

describe("machineMetaLine / machineHeaderMeta", () => {
  it("leads with presence, then platform and the project count", () => {
    expect(
      machineMetaLine({
        host: host(),
        platformLabel: "macOS",
        projectCount: 1,
        serverProtocolVersion: 31,
        now: NOW,
      }),
    ).toBe("Online · macOS · 1 project");
    expect(
      machineMetaLine({
        host: host({ status: "disconnected" }),
        platformLabel: null,
        projectCount: 0,
        serverProtocolVersion: 31,
        now: NOW,
      }),
    ).toBe("Offline · last seen 5m ago · 0 projects");
    expect(
      machineMetaLine({
        host: host({ status: "disconnected", lastSeenAt: null }),
        platformLabel: null,
        projectCount: 2,
        serverProtocolVersion: null,
        now: NOW,
      }),
    ).toBe("Offline · 2 projects");
  });

  it("lets a stranded daemon's update status win over presence", () => {
    const stranded = host({
      status: "disconnected",
      lastRejectedProtocolVersion: 30,
    });
    expect(
      machineMetaLine({
        host: stranded,
        platformLabel: null,
        projectCount: 0,
        serverProtocolVersion: 31,
        now: NOW,
      }),
    ).toBe(
      "Needs update · daemon protocol 30 · server protocol 31 · 0 projects",
    );
    // Server version not loaded yet: still stranded, no made-up number.
    expect(
      machineMetaLine({
        host: stranded,
        platformLabel: null,
        projectCount: 0,
        serverProtocolVersion: null,
        now: NOW,
      }),
    ).toBe("Needs update · daemon protocol 30 · 0 projects");
  });

  it("adds the pairing age to the header line", () => {
    expect(
      machineHeaderMeta({ host: host(), platformLabel: "Linux", now: NOW }),
    ).toBe("Online · Linux · paired 3d ago");
  });
});

describe("countProjectsByHost", () => {
  it("counts a project once per machine even with several sources there", () => {
    const counts = countProjectsByHost([
      { sources: [{ hostId: "a" }, { hostId: "a" }, { hostId: "b" }] },
      { sources: [{ hostId: "b" }] },
      { sources: [] },
    ]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(2);
    expect(counts.get("c")).toBeUndefined();
  });
});
