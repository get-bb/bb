import type { PolicyAction, PolicyResource, Principal } from "@bb/domain";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { isRegistryIssuedRoomProvisioningAuthorization } from "../../src/auth/room-provisioning-authorization.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { ApiError } from "../../src/errors.js";
import { createResolvePrincipalMiddleware } from "../../src/request-context.js";
import { registerRoomProvisioningHttpRoute } from "../../src/room-distribution/room-provisioning-http.js";
import {
  WorkTogetherRoomProvisioningConflictError,
  WorkTogetherRoomProvisioningUnavailableError,
  WorkTogetherRoomRepositoryNotRegisteredError,
  WorkTogetherRoomRepositoryRevisionUnavailableError,
  type WorkTogetherRoomResourceProvisioner,
} from "../../src/room-distribution/room-resource-provisioner.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const PATH = `/api/bb-room-provisioning/v1/room-bindings/${BINDING_ID}`;
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomOwner123",
  kind: "human",
  displayName: "Room Owner",
});
const BODY = Object.freeze({
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
});

function fixture(
  args: {
    allow?: boolean;
    result?: Awaited<
      ReturnType<WorkTogetherRoomResourceProvisioner["provision"]>
    >;
    error?: Error;
  } = {},
) {
  const authorizations: Array<{
    action: PolicyAction;
    resource: PolicyResource;
  }> = [];
  const policy: PrincipalPolicy = {
    async resolve() {
      return Object.freeze({
        principal: PRINCIPAL,
        expiresAtMs: Date.now() + 30_000,
        clientRealtimeScope: "scoped" as const,
        async authorize(action: PolicyAction, resource: PolicyResource) {
          authorizations.push({ action, resource });
          return args.allow === false ||
            !isRegistryIssuedRoomProvisioningAuthorization(action, resource)
            ? { allowed: false as const, reason: "forbidden" as const }
            : { allowed: true as const };
        },
      });
    },
  };
  const provision = vi.fn(async () => {
    if (args.error) throw args.error;
    return (
      args.result ?? {
        bindingId: BINDING_ID,
        projectId: "proj_23456789ab",
        environmentId: "env_23456789ab",
        primaryThreadId: "thr_23456789ab",
        state: "provisioning" as const,
        failureReason: null,
      }
    );
  });
  const app = new Hono();
  app.onError((error) =>
    error instanceof ApiError
      ? error.toResponse()
      : new Response("failed", { status: 500 }),
  );
  app.use(
    "/api/bb-room-provisioning/v1/*",
    createResolvePrincipalMiddleware(policy, "http"),
  );
  registerRoomProvisioningHttpRoute(app, { provision });
  return { app, authorizations, provision };
}

function request(body: unknown = BODY): Request {
  return new Request(`http://cell.invalid${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Room provisioning HTTP adapter", () => {
  it("binds the resolved Principal and path binding to strict launch facts", async () => {
    const test = fixture();
    const response = await test.app.request(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(test.provision).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      launch: { bindingId: BINDING_ID, ...BODY },
    });
    expect(test.authorizations).toHaveLength(1);
    expect(
      isRegistryIssuedRoomProvisioningAuthorization(
        test.authorizations[0]!.action,
        test.authorizations[0]!.resource,
      ),
    ).toBe(true);
  });

  it("authorizes before parsing and rejects extra or forged authority fields", async () => {
    const denied = fixture({ allow: false });
    expect(
      (await denied.app.request(request({ actor: "forged" }))).status,
    ).toBe(404);
    expect(denied.provision).not.toHaveBeenCalled();

    const test = fixture();
    for (const body of [
      { ...BODY, principalId: "user_forged" },
      { ...BODY, bindingId: BINDING_ID },
      { ...BODY, repositoryBindingVersion: 1.5 },
      { ...BODY, baseRevision: "ABC" },
      { ...BODY, environmentTemplate: "direct" },
    ]) {
      expect((await test.app.request(request(body))).status).toBe(400);
    }
    expect(test.provision).not.toHaveBeenCalled();
  });

  it("maps stable ready/conflict/unavailable outcomes without leaking errors", async () => {
    const ready = fixture({
      result: {
        bindingId: BINDING_ID,
        projectId: "proj_23456789ab",
        environmentId: "env_23456789ab",
        primaryThreadId: "thr_23456789ab",
        state: "ready",
        failureReason: null,
      },
    });
    expect((await ready.app.request(request())).status).toBe(200);

    const conflict = fixture({
      error: new WorkTogetherRoomProvisioningConflictError(),
    });
    expect((await conflict.app.request(request())).status).toBe(409);

    const unavailable = fixture({
      error: new WorkTogetherRoomProvisioningUnavailableError(),
    });
    const response = await unavailable.app.request(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Work Together");

    const missing = fixture({
      error: new WorkTogetherRoomRepositoryNotRegisteredError(),
    });
    const missingResponse = await missing.app.request(request());
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      code: "repository_not_registered",
      message: "Repository is not registered on the host",
    });

    const missingRevision = fixture({
      error: new WorkTogetherRoomRepositoryRevisionUnavailableError(),
    });
    const missingRevisionResponse =
      await missingRevision.app.request(request());
    expect(missingRevisionResponse.status).toBe(404);
    expect(await missingRevisionResponse.json()).toEqual({
      code: "repository_revision_unavailable",
      message: "Repository revision is unavailable on the host",
    });

    const hostDown = fixture({
      error: new ApiError(502, "host_unavailable", "Host is not connected"),
    });
    const hostDownResponse = await hostDown.app.request(request());
    expect(hostDownResponse.status).toBe(502);
    expect(await hostDownResponse.json()).toMatchObject({
      code: "host_unavailable",
    });
  });
});
