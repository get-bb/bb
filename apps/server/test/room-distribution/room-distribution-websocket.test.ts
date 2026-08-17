import type { PolicyAction, PolicyResource, Principal } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRegistryIssuedRoomDistributionAuthorization } from "../../src/auth/room-distribution-authorization.js";
import type { ClientSocketSession } from "../../src/request-context.js";
import type {
  RoomJsonObject,
  WorkTogetherRoomDistributionV1,
} from "../../src/room-distribution/room-distribution-port.js";
import {
  createRoomDistributionSocketProtocol,
  ROOM_DISTRIBUTION_MESSAGE_CLOSE_REASON,
  ROOM_DISTRIBUTION_POLICY_CLOSE_REASON,
} from "../../src/room-distribution/room-distribution-websocket.js";

const BINDING_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const SUBAGENT_ID = "55555555-6666-4777-8888-999999999999";
const PRINCIPAL: Principal = Object.freeze({
  id: "user_RoomSocket123",
  kind: "human",
  displayName: "Socket Human",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

function fixture(
  options: {
    authorize?: (
      action: PolicyAction,
      resource: PolicyResource,
    ) => Promise<{
      allowed: boolean;
      reason?: "forbidden";
    }>;
  } = {},
) {
  let emit: ((event: RoomJsonObject) => void) | undefined;
  const closeSubscription = vi.fn();
  const subscribe = vi.fn(async (_context, _cursor, sink) => {
    emit = sink;
    return Object.freeze({ close: closeSubscription });
  });
  const distribution = {
    bootstrap: vi.fn(),
    execute: vi.fn(),
    events: vi.fn(),
    subscribe,
  } as unknown as WorkTogetherRoomDistributionV1;
  const authorizationCalls: Array<{
    action: PolicyAction;
    resource: PolicyResource;
  }> = [];
  const session: ClientSocketSession = Object.freeze({
    principal: PRINCIPAL,
    expiresAtMs: Date.now() + 30_000,
    clientRealtimeScope: "scoped",
    async authorize(action, resource) {
      authorizationCalls.push({ action, resource });
      if (options.authorize)
        return options.authorize(action, resource) as never;
      return isRegistryIssuedRoomDistributionAuthorization(action, resource)
        ? { allowed: true }
        : { allowed: false, reason: "forbidden" };
    },
  });
  const socket = {
    close: vi.fn(),
    send: vi.fn(),
  };
  const protocol = createRoomDistributionSocketProtocol({
    distribution,
    membershipRecheckIntervalMs: 10_000,
  });
  return {
    protocol,
    socket,
    session,
    subscribe,
    closeSubscription,
    authorizationCalls,
    emit: (event: RoomJsonObject) => emit?.(event),
  };
}

describe("Room distribution WebSocket protocol", () => {
  it("binds one Principal/binding/cursor and emits JSON after issued authorization", async () => {
    const test = fixture();
    test.protocol.open(
      test.socket,
      test.session,
      BINDING_ID,
      "evt%3A7",
      SUBAGENT_ID,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(test.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: BINDING_ID, principal: PRINCIPAL }),
      { subagentId: SUBAGENT_ID, cursor: "evt%3A7" },
      expect.any(Function),
    );
    expect(test.authorizationCalls).toHaveLength(1);
    expect(
      isRegistryIssuedRoomDistributionAuthorization(
        test.authorizationCalls[0]!.action,
        test.authorizationCalls[0]!.resource,
      ),
    ).toBe(true);
    test.emit({ type: "event", cursor: "evt%3A8" });
    expect(test.socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "event", cursor: "evt%3A8" }),
    );
  });

  it("forwards Primary ready subagents and subagents.changed replacement JSON", async () => {
    const test = fixture();
    test.protocol.open(test.socket, test.session, BINDING_ID, null, null);
    await vi.advanceTimersByTimeAsync(0);
    const subagents = [
      Object.freeze({
        schemaVersion: 1,
        id: SUBAGENT_ID,
        parent: Object.freeze({ kind: "primary", id: BINDING_ID }),
        label: "Worker",
        summary: null,
        lifecycle: "created",
        attention: Object.freeze({ kind: "none" }),
        capabilities: [],
      }),
    ];
    test.emit(
      Object.freeze({
        type: "ready",
        cursor: "s.0",
        subagents,
      }) as RoomJsonObject,
    );
    expect(test.socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "ready",
        cursor: "s.0",
        subagents,
      }),
    );
    test.emit(
      Object.freeze({
        type: "subagents.changed",
        subagents,
      }) as RoomJsonObject,
    );
    const forwarded = JSON.parse(
      String(test.socket.send.mock.calls.at(-1)?.[0]),
    ) as RoomJsonObject;
    expect(Object.keys(forwarded)).toEqual(["type", "subagents"]);
    expect(forwarded).toEqual({
      type: "subagents.changed",
      subagents,
    });
  });

  it("reauthorizes periodically and closes immediately after policy denial", async () => {
    let calls = 0;
    const test = fixture({
      authorize: async () => {
        calls += 1;
        return calls === 1
          ? { allowed: true }
          : { allowed: false, reason: "forbidden" };
      },
    });
    test.protocol.open(test.socket, test.session, BINDING_ID, null, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.subscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(test.socket.close).toHaveBeenCalledWith(
      1008,
      ROOM_DISTRIBUTION_POLICY_CLOSE_REASON,
    );
    expect(test.closeSubscription).toHaveBeenCalledOnce();
  });

  it("closes at assertion expiry even when work is otherwise healthy", async () => {
    const test = fixture();
    test.protocol.open(test.socket, test.session, BINDING_ID, null, null);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(test.socket.close).toHaveBeenCalledWith(
      1008,
      ROOM_DISTRIBUTION_POLICY_CLOSE_REASON,
    );
    expect(test.closeSubscription).toHaveBeenCalledOnce();
  });

  it("closes on any in-band client message and never retargets", async () => {
    const test = fixture();
    test.protocol.open(test.socket, test.session, BINDING_ID, null, null);
    await vi.advanceTimersByTimeAsync(0);
    test.protocol.message(test.socket);
    expect(test.socket.close).toHaveBeenCalledWith(
      1008,
      ROOM_DISTRIBUTION_MESSAGE_CLOSE_REASON,
    );
    expect(test.closeSubscription).toHaveBeenCalledOnce();
    expect(test.subscribe).toHaveBeenCalledOnce();
  });

  it("fails closed for unrestricted, expired, or hanging authorization sessions", async () => {
    const unrestricted = fixture();
    unrestricted.protocol.open(
      unrestricted.socket,
      { ...unrestricted.session, clientRealtimeScope: "unrestricted" },
      BINDING_ID,
      null,
      null,
    );
    expect(unrestricted.socket.close).toHaveBeenCalledWith(
      1008,
      ROOM_DISTRIBUTION_POLICY_CLOSE_REASON,
    );

    const expired = fixture();
    expired.protocol.open(
      expired.socket,
      { ...expired.session, expiresAtMs: Date.now() },
      BINDING_ID,
      null,
      null,
    );
    expect(expired.socket.close).toHaveBeenCalledWith(
      1008,
      ROOM_DISTRIBUTION_POLICY_CLOSE_REASON,
    );

    const hanging = fixture({
      authorize: () => new Promise(() => {}),
    });
    hanging.protocol.open(
      hanging.socket,
      hanging.session,
      BINDING_ID,
      null,
      null,
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(hanging.socket.close).toHaveBeenCalledWith(
      1008,
      ROOM_DISTRIBUTION_POLICY_CLOSE_REASON,
    );
    expect(hanging.subscribe).not.toHaveBeenCalled();
  });
});
