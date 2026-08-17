import type { PolicyAction, PolicyResource, Principal } from "@bb/domain";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { isRegistryIssuedRoomDistributionAuthorization } from "../../src/auth/room-distribution-authorization.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { ApiError } from "../../src/errors.js";
import { createResolvePrincipalMiddleware } from "../../src/request-context.js";
import { registerRoomDistributionHttpRoutes } from "../../src/room-distribution/room-distribution-http.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
  type WorkTogetherRoomDistributionV1,
} from "../../src/room-distribution/room-distribution-port.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const SUBAGENT_ID = "55555555-6666-4777-8888-999999999999";
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomHttp123",
  kind: "human",
  displayName: "Room Human",
});

function path(operation: string, query = ""): string {
  return `/api/bb-rooms/v1/rooms/${BINDING_ID}/${operation}${query}`;
}

function fixture(
  options: {
    allow?: boolean;
    distribution?: Partial<WorkTogetherRoomDistributionV1>;
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
          return options.allow === false ||
            !isRegistryIssuedRoomDistributionAuthorization(action, resource)
            ? { allowed: false as const, reason: "forbidden" as const }
            : { allowed: true as const };
        },
      });
    },
  };
  const bootstrap = vi.fn(async (_context: RoomDistributionContextV1) => ({
    room: { id: BINDING_ID },
  }));
  const execute = vi.fn(async () => ({
    status: 202 as const,
    body: { receipt: "accepted" },
  }));
  const events = vi.fn(async (_context, target) => ({
    events: [],
    cursor: target.cursor,
  }));
  const timeline = vi.fn(async (_context, target) => ({
    schemaVersion: 1,
    timeline: { rows: [], hasOlder: false, olderCursor: null },
    before: target.before,
  }));
  const subscribe = vi.fn(async () => Object.freeze({ close() {} }));
  const distribution = {
    bootstrap,
    execute,
    events,
    timeline,
    subscribe,
    ...options.distribution,
  } as WorkTogetherRoomDistributionV1;

  const app = new Hono();
  app.onError((error) => {
    if (error instanceof ApiError) {
      return error.toResponse();
    }
    return new Response("unavailable", { status: 503 });
  });
  app.use(
    "/api/bb-rooms/v1/*",
    createResolvePrincipalMiddleware(policy, "http"),
  );
  registerRoomDistributionHttpRoutes(app, distribution);
  return { app, authorizations, bootstrap, execute, events, timeline };
}

describe("Room distribution HTTP adapter", () => {
  it("binds bootstrap/events to the attached Principal and issued room pair", async () => {
    const test = fixture();
    const bootstrapResponse = await test.app.request(path("bootstrap"));
    expect(bootstrapResponse.status).toBe(200);
    expect(await bootstrapResponse.json()).toEqual({
      room: { id: BINDING_ID },
    });
    expect(bootstrapResponse.headers.get("cache-control")).toBe("no-store");
    expect(test.bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
    );

    const eventsResponse = await test.app.request(
      path("events", "?cursor=evt%3A7"),
    );
    expect(eventsResponse.status).toBe(200);
    expect(await eventsResponse.json()).toEqual({
      events: [],
      cursor: "evt%3A7",
    });
    expect(test.events).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
      { subagentId: null, cursor: "evt%3A7" },
    );

    await test.app.request(
      path("events", `?subagent=${SUBAGENT_ID}&cursor=evt%3A8`),
    );
    expect(test.events).toHaveBeenLastCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
      { subagentId: SUBAGENT_ID, cursor: "evt%3A8" },
    );

    const timelineResponse = await test.app.request(
      path("timeline", "?before=p.7"),
    );
    expect(timelineResponse.status).toBe(200);
    expect(timelineResponse.headers.get("cache-control")).toBe("no-store");
    expect(test.timeline).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
      { subagentId: null, before: "p.7" },
    );
    // Older timeline reuses events read authority (no new action).
    expect(test.authorizations.at(-1)?.action).toEqual(
      expect.objectContaining({ name: "roomDistribution.events" }),
    );

    expect(test.authorizations).toHaveLength(4);
    for (const pair of test.authorizations) {
      expect(
        isRegistryIssuedRoomDistributionAuthorization(
          pair.action,
          pair.resource,
        ),
      ).toBe(true);
    }
  });

  it("accepts bounded JSON commands but rejects browser-supplied actor authority", async () => {
    const test = fixture();
    const accepted = await test.app.request(path("commands"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send", requestId: "req_1" }),
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ receipt: "accepted" });
    expect(test.execute).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
      { type: "send", requestId: "req_1" },
    );

    for (const body of [
      { type: "send", actor: { id: "forged" } },
      { type: "send", principalId: "forged" },
      { type: "send", payload: { actor_id: "forged" } },
      { type: "send", payload: { authorId: "forged" } },
      ["send"],
    ]) {
      const response = await test.app.request(path("commands"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(test.execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed before distribution for denied, malformed, and raw targets", async () => {
    const denied = fixture({ allow: false });
    expect((await denied.app.request(path("bootstrap"))).status).toBe(404);
    expect(denied.bootstrap).not.toHaveBeenCalled();

    const malformed = fixture();
    expect(
      (await malformed.app.request(path("events", "?cursor="))).status,
    ).toBe(404);
    expect(
      (await malformed.app.request(path("timeline", "?before=s.1"))).status,
    ).toBe(404);
    expect(
      (
        await malformed.app.request(
          path("timeline", `?before=p.7&subagent=${SUBAGENT_ID}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await malformed.app.request(
          path("timeline", `?child=${SUBAGENT_ID}&before=p.7`),
        )
      ).status,
    ).toBe(404);
    expect(
      (await malformed.app.request(`/api/bb-rooms/v1/rooms/${BINDING_ID}/raw`))
        .status,
    ).toBe(404);
    expect(malformed.events).not.toHaveBeenCalled();
    expect(malformed.timeline).not.toHaveBeenCalled();
  });

  it("passes the canonical Subagent older-page target through unchanged", async () => {
    const test = fixture();
    const response = await test.app.request(
      path("timeline", `?subagent=${SUBAGENT_ID}&before=p.9`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      timeline: { rows: [], hasOlder: false, olderCursor: null },
      before: "p.9",
    });
    expect(test.timeline).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
      { subagentId: SUBAGENT_ID, before: "p.9" },
    );
    expect(test.authorizations).toHaveLength(1);
    expect(test.authorizations[0]?.action).toEqual(
      expect.objectContaining({ name: "roomDistribution.events" }),
    );
  });

  it("maps binding misses without enumeration and upstream failures to unavailable", async () => {
    const missing = fixture({
      distribution: {
        bootstrap: async () => {
          throw new RoomDistributionUnavailableError("not_found");
        },
      },
    });
    expect((await missing.app.request(path("bootstrap"))).status).toBe(404);

    const failed = fixture({
      distribution: {
        events: async () => {
          throw new Error("sqlite:///private/cell.db");
        },
      },
    });
    const response = await failed.app.request(path("events"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private/cell.db");
  });
});
