import { describe, expect, it, vi } from "vitest";
import {
  resolveLocalHostDaemonAccess,
  resolveLocalHostDaemonProbePort,
  type LocalNetworkPermissionQuery,
} from "./local-host-daemon-access";

function createPermissionQuery(
  query: LocalNetworkPermissionQuery["query"],
): LocalNetworkPermissionQuery {
  return { query };
}

describe("local host daemon access", () => {
  it("does not query browser permission without a configured helper", async () => {
    const query = vi.fn<LocalNetworkPermissionQuery["query"]>();

    await expect(
      resolveLocalHostDaemonAccess({
        configuredPort: null,
        hostname: "bb.example.com",
        isDesktop: false,
        permissions: createPermissionQuery(query),
        sessionAccessGranted: false,
      }),
    ).resolves.toBe("unavailable");
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { hostname: "localhost", isDesktop: false },
    { hostname: "bb.example.com", isDesktop: true },
  ])("allows trusted client context %# without a query", async (context) => {
    const query = vi.fn<LocalNetworkPermissionQuery["query"]>();

    await expect(
      resolveLocalHostDaemonAccess({
        configuredPort: 38_887,
        ...context,
        permissions: createPermissionQuery(query),
        sessionAccessGranted: false,
      }),
    ).resolves.toBe("available");
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { permissionState: "granted" as const, accessState: "available" },
    {
      permissionState: "prompt" as const,
      accessState: "permission-required",
    },
    { permissionState: "denied" as const, accessState: "denied" },
  ])(
    "maps $permissionState permission to $accessState",
    async ({ permissionState, accessState }) => {
      const query = vi.fn<LocalNetworkPermissionQuery["query"]>(async () => ({
        state: permissionState,
      }));

      await expect(
        resolveLocalHostDaemonAccess({
          configuredPort: 38_887,
          hostname: "bb.example.com",
          isDesktop: false,
          permissions: createPermissionQuery(query),
          sessionAccessGranted: false,
        }),
      ).resolves.toBe(accessState);
      expect(query).toHaveBeenCalledExactlyOnceWith({
        name: "loopback-network",
      });
    },
  );

  it("falls back to Chrome's original permission name", async () => {
    const query = vi.fn<LocalNetworkPermissionQuery["query"]>(
      async ({ name }) => {
        if (name === "loopback-network") {
          throw new TypeError("unsupported permission");
        }
        return { state: "granted" };
      },
    );

    await expect(
      resolveLocalHostDaemonAccess({
        configuredPort: 38_887,
        hostname: "bb.example.com",
        isDesktop: false,
        permissions: createPermissionQuery(query),
        sessionAccessGranted: false,
      }),
    ).resolves.toBe("available");
    expect(query.mock.calls).toEqual([
      [{ name: "loopback-network" }],
      [{ name: "local-network-access" }],
    ]);
  });

  it("fails closed when the browser cannot report permission", async () => {
    const query = vi.fn<LocalNetworkPermissionQuery["query"]>(async () => {
      throw new TypeError("unsupported permission");
    });

    await expect(
      resolveLocalHostDaemonAccess({
        configuredPort: 38_887,
        hostname: "bb.example.com",
        isDesktop: false,
        permissions: createPermissionQuery(query),
        sessionAccessGranted: false,
      }),
    ).resolves.toBe("unsupported");
  });

  it("trusts access already proven by an explicit session request", async () => {
    const query = vi.fn<LocalNetworkPermissionQuery["query"]>();

    await expect(
      resolveLocalHostDaemonAccess({
        configuredPort: 38_887,
        hostname: "bb.example.com",
        isDesktop: false,
        permissions: createPermissionQuery(query),
        sessionAccessGranted: true,
      }),
    ).resolves.toBe("available");
    expect(query).not.toHaveBeenCalled();
  });

  it("only exposes the helper port when probing is available", () => {
    expect(resolveLocalHostDaemonProbePort(38_887, "available")).toBe(38_887);
    expect(
      resolveLocalHostDaemonProbePort(38_887, "permission-required"),
    ).toBeNull();
    expect(resolveLocalHostDaemonProbePort(38_887, "denied")).toBeNull();
    expect(resolveLocalHostDaemonProbePort(38_887, "unsupported")).toBeNull();
  });
});
