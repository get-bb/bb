import { describe, expect, it } from "vitest";
import {
  InvalidRoomDistributionTargetError,
  parseRoomDistributionTarget,
  type RoomDistributionTargetInput,
} from "../../src/room-distribution/room-distribution-target.js";

const BINDING_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CURSOR = "evt_01HZX9k.abc~1";
const SECRET_CURSOR = "super-secret-cursor-token-xyz";
const SECRET_ID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";
const SUBAGENT_ID = "11111111-2222-4333-8444-555555555555";

function targetFor(
  operation: string,
  bindingId = BINDING_ID,
  query?: string,
): string {
  const base = `/api/bb-rooms/v1/rooms/${bindingId}/${operation}`;
  return query === undefined ? base : `${base}?${query}`;
}

function parse(input: RoomDistributionTargetInput) {
  return parseRoomDistributionTarget(input);
}

function expectRejected(
  input: RoomDistributionTargetInput,
  leakedFragments: string[] = [],
): void {
  expect(() => parse(input)).toThrow(InvalidRoomDistributionTargetError);
  try {
    parse(input);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidRoomDistributionTargetError);
    const err = error as InvalidRoomDistributionTargetError;
    expect(err.message).toBe("Invalid room distribution target");
    expect(err.code).toBe("invalid_room_distribution_target");
    expect(err.name).toBe("InvalidRoomDistributionTargetError");
    if (
      input !== null &&
      typeof input === "object" &&
      typeof input.target === "string" &&
      input.target.length > 0
    ) {
      expect(err.message).not.toContain(input.target);
    }
    for (const fragment of leakedFragments) {
      if (fragment.length > 0) {
        expect(err.message).not.toContain(fragment);
        expect(err.code).not.toContain(fragment);
      }
    }
    expect(err.message.toLowerCase()).not.toMatch(
      /secret|token|bearer|password/,
    );
  }
}

describe("parseRoomDistributionTarget", () => {
  it("accepts GET http bootstrap with no query", () => {
    const target = targetFor("bootstrap");
    const descriptor = parse({
      method: "GET",
      transport: "http",
      target,
    });
    expect(descriptor).toEqual({
      bindingId: BINDING_ID,
      operation: "bootstrap",
      method: "GET",
      transport: "http",
      cursor: null,
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("accepts POST http commands with no query", () => {
    const target = targetFor("commands");
    const descriptor = parse({
      method: "POST",
      transport: "http",
      target,
    });
    expect(descriptor).toEqual({
      bindingId: BINDING_ID,
      operation: "commands",
      method: "POST",
      transport: "http",
      cursor: null,
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("accepts GET http events with and without cursor", () => {
    const without = parse({
      method: "GET",
      transport: "http",
      target: targetFor("events"),
    });
    expect(without).toEqual({
      bindingId: BINDING_ID,
      operation: "events",
      method: "GET",
      transport: "http",
      cursor: null,
      subagentId: null,
    });
    expect(Object.isFrozen(without)).toBe(true);

    const withCursor = parse({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, `cursor=${CURSOR}`),
    });
    expect(withCursor).toEqual({
      bindingId: BINDING_ID,
      operation: "events",
      method: "GET",
      transport: "http",
      cursor: CURSOR,
      subagentId: null,
    });
    expect(Object.isFrozen(withCursor)).toBe(true);
  });

  it("accepts GET http timeline with public sequence-only before cursor", () => {
    const descriptor = parse({
      method: "GET",
      transport: "http",
      target: targetFor("timeline", BINDING_ID, "before=p.42"),
    });
    expect(descriptor).toEqual({
      bindingId: BINDING_ID,
      operation: "timeline",
      method: "GET",
      transport: "http",
      before: "p.42",
      subagentId: null,
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("accepts GET http timeline with Subagent then public before cursor", () => {
    const descriptor = parse({
      method: "GET",
      transport: "http",
      target: targetFor(
        "timeline",
        BINDING_ID,
        `subagent=${SUBAGENT_ID}&before=p.42`,
      ),
    });
    expect(descriptor).toEqual({
      bindingId: BINDING_ID,
      operation: "timeline",
      method: "GET",
      transport: "http",
      before: "p.42",
      subagentId: SUBAGENT_ID,
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("rejects non-public or malformed timeline before cursors", () => {
    for (const query of [
      undefined,
      "before=p.0",
      "before=p.01",
      "before=s.1",
      "before=1",
      "cursor=p.1",
      "before=p.1&subagent=11111111-2222-4333-8444-555555555555",
      "before=",
      "before=p.",
      "before=p.-1",
    ]) {
      expectRejected({
        method: "GET",
        transport: "http",
        target: targetFor(
          "timeline",
          BINDING_ID,
          query === undefined ? undefined : query,
        ),
      });
    }
    expectRejected({
      method: "POST",
      transport: "http",
      target: targetFor("timeline", BINDING_ID, "before=p.1"),
    });
    expectRejected({
      method: "GET",
      transport: "websocket",
      target: targetFor("timeline", BINDING_ID, "before=p.1"),
    });
  });

  it("rejects inverted, obsolete, or malformed Subagent older-page queries", () => {
    for (const query of [
      `subagent=${SUBAGENT_ID}`,
      `subagent=${SUBAGENT_ID}&before=`,
      `subagent=${SUBAGENT_ID}&before=p.0`,
      `subagent=${SUBAGENT_ID}&before=p.01`,
      `subagent=${SUBAGENT_ID}&before=s.1`,
      `subagent=${SUBAGENT_ID}&cursor=p.1`,
      `child=${SUBAGENT_ID}&before=p.1`,
      "subagent=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE&before=p.1",
      `subagent=%31${SUBAGENT_ID.slice(1)}&before=p.1`,
      `subagent=${SUBAGENT_ID}&subagent=${SUBAGENT_ID}&before=p.1`,
      `subagent=${SUBAGENT_ID}&before=p.1&before=p.2`,
      `subagent=${SUBAGENT_ID}&before=p.1&limit=1`,
      `subagent=${SUBAGENT_ID}&before=p.1&cursor=s.1`,
      "subagent=not-a-uuid&before=p.1",
    ]) {
      expectRejected({
        method: "GET",
        transport: "http",
        target: targetFor("timeline", BINDING_ID, query),
      });
    }
    expectRejected({
      method: "POST",
      transport: "http",
      target: targetFor(
        "timeline",
        BINDING_ID,
        `subagent=${SUBAGENT_ID}&before=p.1`,
      ),
    });
    expectRejected({
      method: "GET",
      transport: "websocket",
      target: targetFor(
        "timeline",
        BINDING_ID,
        `subagent=${SUBAGENT_ID}&before=p.1`,
      ),
    });
  });

  it("accepts GET websocket subscribe with and without cursor", () => {
    const without = parse({
      method: "GET",
      transport: "websocket",
      target: targetFor("subscribe"),
    });
    expect(without).toEqual({
      bindingId: BINDING_ID,
      operation: "subscribe",
      method: "GET",
      transport: "websocket",
      cursor: null,
      subagentId: null,
    });
    expect(Object.isFrozen(without)).toBe(true);

    const withCursor = parse({
      method: "GET",
      transport: "websocket",
      target: targetFor("subscribe", BINDING_ID, `cursor=${CURSOR}`),
    });
    expect(withCursor).toEqual({
      bindingId: BINDING_ID,
      operation: "subscribe",
      method: "GET",
      transport: "websocket",
      cursor: CURSOR,
      subagentId: null,
    });
    expect(Object.isFrozen(withCursor)).toBe(true);
  });

  it("accepts an opaque Subagent attachment before an optional cursor", () => {
    expect(
      parse({
        method: "GET",
        transport: "http",
        target: targetFor("events", BINDING_ID, `subagent=${SUBAGENT_ID}`),
      }),
    ).toMatchObject({ subagentId: SUBAGENT_ID, cursor: null });
    expect(
      parse({
        method: "GET",
        transport: "websocket",
        target: targetFor(
          "subscribe",
          BINDING_ID,
          `subagent=${SUBAGENT_ID}&cursor=${CURSOR}`,
        ),
      }),
    ).toMatchObject({ subagentId: SUBAGENT_ID, cursor: CURSOR });
  });

  it("returns bindingId unchanged for any-version lowercase UUIDs", () => {
    const ids = [
      "00000000-0000-0000-0000-000000000000",
      "123e4567-e89b-12d3-a456-426614174000",
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ];
    for (const bindingId of ids) {
      const descriptor = parse({
        method: "GET",
        transport: "http",
        target: targetFor("bootstrap", bindingId),
      });
      expect(descriptor.bindingId).toBe(bindingId);
    }
  });

  it("preserves the exact raw cursor without decoding or reserializing", () => {
    // Percent-encoded colon is valid under both the opaque grammar and
    // canonicalizeInternalRequestTarget (raw ":" is non-canonical).
    const raw = "a%3Ab.c_1~x";
    const descriptor = parse({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, `cursor=${raw}`),
    });
    expect(descriptor.operation).toBe("events");
    if (descriptor.operation !== "events") return;
    expect(descriptor.cursor).toBe(raw);
  });

  it("rejects wrong method or transport for each operation", () => {
    expectRejected({
      method: "POST",
      transport: "http",
      target: targetFor("bootstrap"),
    });
    expectRejected({
      method: "GET",
      transport: "websocket",
      target: targetFor("bootstrap"),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("commands"),
    });
    expectRejected({
      method: "POST",
      transport: "websocket",
      target: targetFor("commands"),
    });
    expectRejected({
      method: "POST",
      transport: "http",
      target: targetFor("events"),
    });
    expectRejected({
      method: "GET",
      transport: "websocket",
      target: targetFor("events"),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("subscribe"),
    });
    expectRejected({
      method: "POST",
      transport: "websocket",
      target: targetFor("subscribe"),
    });
    expectRejected({
      method: "get",
      transport: "http",
      target: targetFor("bootstrap"),
    });
    expectRejected({
      method: "GET",
      transport: "HTTP",
      target: targetFor("bootstrap"),
    });
    expectRejected({
      method: "GET",
      transport: "ws",
      target: targetFor("subscribe"),
    });
  });

  it("rejects query on bootstrap and commands", () => {
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("bootstrap", BINDING_ID, `cursor=${CURSOR}`),
    });
    expectRejected({
      method: "POST",
      transport: "http",
      target: targetFor("commands", BINDING_ID, `cursor=${CURSOR}`),
    });
  });

  it("rejects empty cursor, duplicates, extra keys, and bare query", () => {
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, "cursor="),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, `cursor=${CURSOR}&cursor=other`),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, `cursor=${CURSOR}&limit=1`),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, "limit=1"),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `${targetFor("events")}?`,
    });
    expectRejected({
      method: "GET",
      transport: "websocket",
      target: targetFor("subscribe", BINDING_ID, "cursor="),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor(
        "events",
        BINDING_ID,
        `cursor=${CURSOR}&subagent=${SUBAGENT_ID}`,
      ),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, "subagent=not-a-uuid"),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor(
        "events",
        BINDING_ID,
        `subagent=${SUBAGENT_ID}&cursor=`,
      ),
    });
    for (const query of [
      `child=${SUBAGENT_ID}`,
      `subagent=${SUBAGENT_ID}&subagent=${SUBAGENT_ID}`,
      "subagent=AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      `subagent=%31${SUBAGENT_ID.slice(1)}`,
    ]) {
      expectRejected({
        method: "GET",
        transport: "http",
        target: targetFor("events", BINDING_ID, query),
      });
    }
  });

  it("rejects cursor grammar violations while never decoding", () => {
    // Spaces and controls are non-canonical; mapped to generic error.
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, "cursor=a b"),
    });
    // Over-long cursor (513 valid chars).
    const long = "a".repeat(513);
    expectRejected(
      {
        method: "GET",
        transport: "http",
        target: targetFor("events", BINDING_ID, `cursor=${long}`),
      },
      [long],
    );
    // Disallowed raw characters under the opaque grammar (and non-canonical).
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, "cursor=a/b"),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("events", BINDING_ID, "cursor=a?b"),
    });
  });

  it("rejects trailing slash, extra path segments, and unknown operations", () => {
    expectRejected({
      method: "GET",
      transport: "http",
      target: `${targetFor("bootstrap")}/`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `${targetFor("bootstrap")}/extra`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: targetFor("bootstrapx"),
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/rooms/${BINDING_ID}`,
    });
  });

  it("rejects fragments, absolute URLs, and network-path targets", () => {
    expectRejected({
      method: "GET",
      transport: "http",
      target: `${targetFor("bootstrap")}#frag`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `https://example.test${targetFor("bootstrap")}`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `//example.test${targetFor("bootstrap")}`,
    });
  });

  it("rejects encoded separators, dot ambiguity, and non-canonical percent forms", () => {
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/rooms/${BINDING_ID}/%2E%2E/bootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/rooms/${BINDING_ID}/./bootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/rooms/${BINDING_ID}/../bootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/rooms/${BINDING_ID}/%2Fbootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/rooms/${BINDING_ID}/boot%73trap`,
    });
  });

  it("rejects uppercase UUID binding ids", () => {
    const upper = BINDING_ID.toUpperCase();
    expectRejected(
      {
        method: "GET",
        transport: "http",
        target: targetFor("bootstrap", upper),
      },
      [upper, BINDING_ID],
    );
  });

  it("rejects internal/public prefix confusion", () => {
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/v1/rooms/${BINDING_ID}/bootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/internal/bb-rooms/v1/rooms/${BINDING_ID}/bootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v1/room/${BINDING_ID}/bootstrap`,
    });
    expectRejected({
      method: "GET",
      transport: "http",
      target: `/api/bb-rooms/v2/rooms/${BINDING_ID}/bootstrap`,
    });
  });

  it("never echoes target, cursor, or binding id on rejection", () => {
    expectRejected(
      {
        method: "GET",
        transport: "http",
        target: targetFor(
          "events",
          SECRET_ID,
          `cursor=${SECRET_CURSOR}&leak=1`,
        ),
      },
      [SECRET_ID, SECRET_CURSOR, "leak=1"],
    );
  });

  it("rejects non-object and non-string inputs without leaking", () => {
    expectRejected(null as unknown as RoomDistributionTargetInput);
    expectRejected({
      method: "GET",
      transport: "http",
      target: 1 as unknown as string,
    });
    expectRejected({
      method: 1 as unknown as string,
      transport: "http",
      target: targetFor("bootstrap"),
    });
  });
});
