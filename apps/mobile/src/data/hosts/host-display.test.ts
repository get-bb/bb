import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract/protocol";
import { describe, expect, it } from "vitest";
import { resolveHostDependentAvailability } from "./host-availability";
import {
  countProjectsByHost,
  formatRelativeAge,
  machineHeaderMeta,
  machineMetaLine,
} from "./host-display";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
  hostNeedsUpdate,
} from "./host-update-status";

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

describe("host update status", () => {
  it("flags only a disconnected daemon rejected on another protocol", () => {
    expect(hostNeedsUpdate(host())).toBe(false);
    expect(
      hostNeedsUpdate(
        host({ status: "connected", lastRejectedProtocolVersion: 1 }),
      ),
    ).toBe(false);
    expect(
      hostNeedsUpdate(
        host({
          status: "disconnected",
          lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        }),
      ),
    ).toBe(false);
    const stranded = host({
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
    });
    expect(hostNeedsUpdate(stranded)).toBe(true);
    expect(hostCanRetryUpdate(stranded)).toBe(true);
    expect(formatHostUpdateStatus(stranded)).toBe(
      `Needs update · daemon protocol ${HOST_DAEMON_PROTOCOL_VERSION - 1} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`,
    );
  });

  it("does not offer a retry to a daemon newer than the server", () => {
    const newer = host({
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
    });
    expect(hostNeedsUpdate(newer)).toBe(true);
    expect(hostCanRetryUpdate(newer)).toBe(false);
  });
});

describe("machineMetaLine / machineHeaderMeta", () => {
  it("leads with presence, then platform and the project count", () => {
    expect(
      machineMetaLine({
        host: host(),
        platformLabel: "macOS",
        projectCount: 1,
        now: NOW,
      }),
    ).toBe("Online · macOS · 1 project");
    expect(
      machineMetaLine({
        host: host({ status: "disconnected" }),
        platformLabel: null,
        projectCount: 0,
        now: NOW,
      }),
    ).toBe("Offline · last seen 5m ago · 0 projects");
    expect(
      machineMetaLine({
        host: host({ status: "disconnected", lastSeenAt: null }),
        platformLabel: null,
        projectCount: 2,
        now: NOW,
      }),
    ).toBe("Offline · 2 projects");
  });

  it("lets a stranded daemon's update status win over presence", () => {
    const line = machineMetaLine({
      host: host({
        status: "disconnected",
        lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      }),
      platformLabel: null,
      projectCount: 0,
      now: NOW,
    });
    expect(line.startsWith("Needs update · daemon protocol")).toBe(true);
    expect(line.endsWith("0 projects")).toBe(true);
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

describe("resolveHostDependentAvailability", () => {
  it("is loading until both the host list and the config answered", () => {
    expect(
      resolveHostDependentAvailability({
        hosts: undefined,
        primaryHostId: "h1",
      }).state,
    ).toBe("loading");
    expect(
      resolveHostDependentAvailability({
        hosts: [host()],
        primaryHostId: undefined,
      }).state,
    ).toBe("loading");
  });

  it("reports no host, an offline primary, or ready", () => {
    expect(
      resolveHostDependentAvailability({ hosts: [], primaryHostId: null })
        .state,
    ).toBe("no-host");
    // A primary id the list does not contain is not promoted to another host.
    expect(
      resolveHostDependentAvailability({
        hosts: [host()],
        primaryHostId: "other",
      }).state,
    ).toBe("no-host");
    const offline = resolveHostDependentAvailability({
      hosts: [host({ status: "disconnected" })],
      primaryHostId: "h1",
    });
    expect(offline.state).toBe("offline");
    expect(offline.host?.id).toBe("h1");
    expect(
      resolveHostDependentAvailability({ hosts: [host()], primaryHostId: "h1" })
        .state,
    ).toBe("ready");
  });
});
