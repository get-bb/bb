import type {
  PolicyAction,
  PolicyResource,
  Principal,
  PrincipalRequest,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { isRegistryIssuedRoomDistributionAuthorization } from "../../src/auth/room-distribution-authorization.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { createApp } from "../../src/server.js";
import type { WorkTogetherRoomDistributionV1 } from "../../src/room-distribution/room-distribution-port.js";
import {
  createTestAppHarness,
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const SUBAGENT_ID = "55555555-6666-4777-8888-999999999999";
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomProcess123",
  kind: "human",
  displayName: "Process Human",
});
const PREFIX = `/api/bb-rooms/v1/rooms/${BINDING_ID}`;
const openServers: RunningTestServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

describe("Room distribution real process boundary", () => {
  it("serves only the four Principal-bound HTTP/WS operations", async () => {
    const requests: PrincipalRequest[] = [];
    const policy: PrincipalPolicy = {
      async resolve(request) {
        requests.push(request);
        return Object.freeze({
          principal: PRINCIPAL,
          expiresAtMs: Date.now() + 30_000,
          clientRealtimeScope: "scoped" as const,
          async authorize(action: PolicyAction, resource: PolicyResource) {
            return isRegistryIssuedRoomDistributionAuthorization(
              action,
              resource,
            )
              ? { allowed: true as const }
              : { allowed: false as const, reason: "forbidden" as const };
          },
        });
      },
    };
    const bootstrap = vi.fn(async () => ({ room: { id: BINDING_ID } }));
    const execute = vi.fn(async () => ({
      status: 202 as const,
      body: { receipt: "accepted" },
    }));
    const events = vi.fn(async (_context, target) => ({
      events: [],
      cursor: target.cursor,
    }));
    const timeline = vi.fn(async () => ({
      schemaVersion: 1,
      timeline: { rows: [], hasOlder: false, olderCursor: null },
    }));
    const subscribe = vi.fn(async (_context, target, emit) => {
      emit({ type: "ready", cursor: target.cursor ?? "origin" });
      return Object.freeze({ close() {} });
    });
    const distribution = {
      bootstrap,
      execute,
      events,
      timeline,
      subscribe,
    } as WorkTogetherRoomDistributionV1;
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: policy,
        roomDistribution: distribution,
      },
    );
    openServers.push(server);

    const bootstrapResponse = await fetch(
      `${server.baseUrl}${PREFIX}/bootstrap`,
    );
    expect(bootstrapResponse.status).toBe(200);
    expect(await bootstrapResponse.json()).toEqual({
      room: { id: BINDING_ID },
    });

    const commandResponse = await fetch(`${server.baseUrl}${PREFIX}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send", requestId: "req_process_1" }),
    });
    expect(commandResponse.status).toBe(202);

    const eventsResponse = await fetch(
      `${server.baseUrl}${PREFIX}/events?subagent=${SUBAGENT_ID}&cursor=evt%3A7`,
    );
    expect(eventsResponse.status).toBe(200);
    expect(await eventsResponse.json()).toEqual({
      events: [],
      cursor: "evt%3A7",
    });

    const socket = new WebSocket(
      websocketUrl(
        server.baseUrl,
        `${PREFIX}/subscribe?subagent=${SUBAGENT_ID}&cursor=evt%3A8`,
      ),
    );
    const message = await new Promise<string>((resolve, reject) => {
      socket.once("message", (data) => resolve(data.toString("utf8")));
      socket.once("error", reject);
    });
    expect(JSON.parse(message)).toEqual({ type: "ready", cursor: "evt%3A8" });
    socket.close();

    expect(
      requests.map(({ method, target, transport }) => ({
        method,
        target,
        transport,
      })),
    ).toEqual([
      { method: "GET", target: `${PREFIX}/bootstrap`, transport: "http" },
      { method: "POST", target: `${PREFIX}/commands`, transport: "http" },
      {
        method: "GET",
        target: `${PREFIX}/events?subagent=${SUBAGENT_ID}&cursor=evt%3A7`,
        transport: "http",
      },
      {
        method: "GET",
        target: `${PREFIX}/subscribe?subagent=${SUBAGENT_ID}&cursor=evt%3A8`,
        transport: "websocket",
      },
    ]);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(events.mock.calls[0]![1]).toEqual({
      subagentId: SUBAGENT_ID,
      cursor: "evt%3A7",
    });
    expect(subscribe.mock.calls[0]![1]).toEqual({
      subagentId: SUBAGENT_ID,
      cursor: "evt%3A8",
    });

    expect((await fetch(`${server.baseUrl}${PREFIX}/raw`)).status).toBe(404);
    expect((await fetch(`${server.baseUrl}/api/v1/system/info`)).status).toBe(
      404,
    );
  });

  it("refuses Room distribution composition outside work-together mode", async () => {
    const harness = await createTestAppHarness();
    const distribution = {
      bootstrap: vi.fn(),
      execute: vi.fn(),
      events: vi.fn(),
      subscribe: vi.fn(),
    } as unknown as WorkTogetherRoomDistributionV1;
    try {
      expect(() =>
        createApp(harness.deps, { roomDistribution: distribution }),
      ).toThrow("Room distribution requires work-together principal mode");
    } finally {
      await harness.cleanup();
    }
  });
});
