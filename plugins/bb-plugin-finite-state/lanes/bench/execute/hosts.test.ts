import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BenchHostError,
  createBenchHostJoinCode,
  listBenchHosts,
  selectBenchHost,
  startBenchThread,
} from "./hosts.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function enrolled(id: string, status: "connected" | "disconnected" = "connected") {
  return {
    id,
    name: `Host ${id}`,
    type: "persistent" as const,
    status,
    maxPermissionMode: "full" as const,
    lastSeenAt: 1_000,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("bench hosts", () => {
  it("mints a one-time SDK join code with an ISO expiry and never calls bb.hosts", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-bench-host-enrollment",
      sdk: {
        hosts: {
          createJoinCode: async () => ({ joinCode: "join-1", hostId: "host-1", expiresAt: 2_000 }),
        },
      },
    });
    hosts.push(host);
    await expect(createBenchHostJoinCode(host.bb)).resolves.toEqual({
      joinCode: "join-1",
      hostId: "host-1",
      expiresAt: "1970-01-01T00:00:02.000Z",
    });
    expect(host.harness.inspection.sdk.callsTo("hosts.createJoinCode")).toHaveLength(1);
    expect(host.harness.sharedPortDeclarations).toEqual([]);
  });

  it("rejects a target that has not redeemed its host-daemon enrollment", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-bench-host-missing",
      sdk: { hosts: { list: async () => [] } },
    });
    hosts.push(host);
    const inspect = vi.fn();
    await expect(
      selectBenchHost(
        host.bb,
        { inspect },
        "host-missing",
        [],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "HOST_NOT_ENROLLED" });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("reports each missing Tier 1 prerequisite concretely", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-bench-host-capabilities",
      sdk: { hosts: { list: async () => [enrolled("host-1")] } },
    });
    hosts.push(host);
    await expect(
      selectBenchHost(
        host.bb,
        {
          inspect: async () => ({
            allowPentest: false,
            docker: false,
            cveEvidenceVerifier: false,
            forgeCompute: true,
          }),
        },
        "host-1",
        ["forgeCompute", "allowPentest", "docker", "cveEvidenceVerifier"],
        new AbortController().signal,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BenchHostError>>({
        code: "HOST_PREREQUISITES_MISSING",
        missing: ["allowPentest", "docker", "cveEvidenceVerifier"],
      }),
    );
  });

  it("reports inspected capabilities for connected enrolled hosts", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-bench-host-list-capabilities",
      sdk: { hosts: { list: async () => [enrolled("host-1")] } },
    });
    hosts.push(host);
    await expect(
      listBenchHosts(host.bb, {
        probe: {
          inspect: async () => ({
            allowPentest: true,
            docker: true,
            cveEvidenceVerifier: false,
            forgeCompute: true,
          }),
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "host-1",
        capabilities: ["forgeCompute", "allowPentest", "docker"],
      }),
    ]);
  });

  it("starts a hidden server-initiated thread on the selected enrolled host", async () => {
    const spawn = vi.fn(async () => ({ id: "thread-bench" }));
    const host = createFakePluginHost({
      pluginId: "finite-state-bench-host-thread",
      sdk: { threads: { spawn } },
    });
    hosts.push(host);
    await expect(
      startBenchThread(host.bb, {
        projectId: "project-a",
        pvId: "version-a",
        tier: "tier1",
        hostId: "host-1",
        workspacePath: "/bench/rootfs",
        firmwareDigest: "a".repeat(64),
      }),
    ).resolves.toBe("thread-bench");
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "hidden",
        environment: {
          type: "host",
          hostId: "host-1",
          workspace: { type: "unmanaged", path: "/bench/rootfs" },
        },
      }),
    );
  });
});
