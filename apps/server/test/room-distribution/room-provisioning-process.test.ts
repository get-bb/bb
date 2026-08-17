import type {
  PolicyAction,
  PolicyResource,
  Principal,
  PrincipalRequest,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRegistryIssuedRoomProvisioningAuthorization } from "../../src/auth/room-provisioning-authorization.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import type { WorkTogetherRoomResourceProvisioner } from "../../src/room-distribution/room-resource-provisioner.js";
import { createApp } from "../../src/server.js";
import {
  createTestAppHarness,
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const PATH = `/api/bb-room-provisioning/v1/room-bindings/${BINDING_ID}`;
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomOwner123",
  kind: "human",
  displayName: "Room Owner",
});
const BODY = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  cellId: "33333333-3333-4333-8333-333333333333",
  repositoryBindingId: "44444444-4444-4444-8444-444444444444",
  repositoryBindingVersion: 7,
  providerRepositoryId: "42",
  baseBranch: "main",
  baseRevision: "a".repeat(40),
  generatedBranch: "rooms/room-1",
  candidateHostId: "55555555-5555-4555-8555-555555555555",
  environmentTemplate: "managed-worktree",
};
const openServers: RunningTestServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("Room provisioning real process boundary", () => {
  it("mounts only the target-bound Principal control-plane route", async () => {
    const requests: PrincipalRequest[] = [];
    const policy: PrincipalPolicy = {
      async resolve(request) {
        requests.push(request);
        return Object.freeze({
          principal: PRINCIPAL,
          expiresAtMs: Date.now() + 30_000,
          clientRealtimeScope: "scoped" as const,
          async authorize(action: PolicyAction, resource: PolicyResource) {
            return isRegistryIssuedRoomProvisioningAuthorization(
              action,
              resource,
            )
              ? { allowed: true as const }
              : { allowed: false as const, reason: "forbidden" as const };
          },
        });
      },
    };
    const provision = vi.fn(async () => ({
      bindingId: BINDING_ID,
      projectId: "proj_23456789ab",
      environmentId: "env_23456789ab",
      primaryThreadId: "thr_23456789ab",
      state: "provisioning" as const,
      failureReason: null,
    }));
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: policy,
        roomResourceProvisioner: { provision },
      },
    );
    openServers.push(server);

    const response = await fetch(`${server.baseUrl}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    });
    expect(response.status).toBe(202);
    expect(provision).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      launch: { bindingId: BINDING_ID, ...BODY },
    });
    expect(
      requests.map(({ method, target, transport }) => ({
        method,
        target,
        transport,
      })),
    ).toEqual([{ method: "POST", target: PATH, transport: "http" }]);

    expect(
      (
        await fetch(
          `${server.baseUrl}/api/bb-rooms/v1/rooms/${BINDING_ID}/provision`,
          { method: "POST" },
        )
      ).status,
    ).toBe(404);
    expect(provision).toHaveBeenCalledOnce();
  });

  it("refuses provisioning composition outside work-together mode", async () => {
    const harness = await createTestAppHarness();
    const provisioner = {
      provision: vi.fn(),
    } as unknown as WorkTogetherRoomResourceProvisioner;
    try {
      expect(() =>
        createApp(harness.deps, { roomResourceProvisioner: provisioner }),
      ).toThrow("Room provisioning requires work-together principal mode");
    } finally {
      await harness.cleanup();
    }
  });
});
