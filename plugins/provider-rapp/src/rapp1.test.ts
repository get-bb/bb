import { describe, expect, it } from "vitest";
import {
  canonicalString,
  createSessionEgg,
  hashValue,
  mintKeylessRappid,
  parseSessionEgg,
  serializeSessionEgg,
  sessionEggAddress,
} from "./rapp1.js";

describe("RAPP/1 primitives", () => {
  it("matches the public canonicalization and domain-hash vectors", () => {
    expect(
      canonicalString({
        b: 1,
        a: [3, 2],
        c: { y: 1, x: 2 },
      }),
    ).toBe('{"a":[3,2],"b":1,"c":{"x":2,"y":1}}');
    expect(
      canonicalString({
        é: 1,
        é: 2,
        b: 5,
        aa: 6,
        "a-b": 7,
        a: 3,
        B: 4,
      }),
    ).toBe('{"B":4,"a":3,"a-b":7,"aa":6,"b":5,"é":2,"é":1}');
    expect(hashValue("rapp/1:particle", { x: 1 })).toBe(
      "2ba28c1fad4d0fbea812dddc74f13e3d097099fb07ce621fd208282ade5e5fc3",
    );
  });

  it("accepts finite JCS numbers and refuses non-I-JSON values", () => {
    expect(canonicalString(2 ** 53)).toBe("9007199254740992");
    expect(canonicalString(1e21)).toBe("1e+21");
    expect(() => canonicalString({ value: Number.POSITIVE_INFINITY })).toThrow(
      "finite",
    );
    expect(() => canonicalString("\ud800")).toThrow("unpaired");
    expect(() => canonicalString(new Array(1))).toThrow("sparse");
  });

  it("round-trips a canonical session egg and rejects non-canonical bytes", () => {
    const identity = mintKeylessRappid(
      "get-bb",
      "provider-rapp",
      "123e4567-e89b-42d3-a456-426614174000",
    );
    const egg = createSessionEgg({
      rappid: identity.rappid,
      createdUtc: "2026-09-02T14:00:00.000Z",
      runtime: {
        provider: "bb/provider-rapp",
        provider_thread_id: "rapp_thread",
        remote_session_id: null,
        turn_counter: 1,
        pending_turn: {
          idempotency_key: "rapp_thread:1",
          user_input: "hello",
          conversation_history: [{ role: "user", content: "context" }],
        },
      },
      transcript: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });
    const serialized = serializeSessionEgg(egg);
    const parsed = parseSessionEgg(Buffer.from(serialized), identity.rappid);
    expect(parsed.runtime.remote_session_id).toBeNull();
    expect(parsed.runtime.pending_turn).toEqual({
      idempotency_key: "rapp_thread:1",
      user_input: "hello",
      conversation_history: [{ role: "user", content: "context" }],
    });
    expect(parsed.egg.payload.transcript).toHaveLength(2);
    expect(parsed.eggAddress).toMatch(/^[0-9a-f]{64}$/u);
    expect(() =>
      parseSessionEgg(Buffer.from(`${JSON.stringify(egg)}\n`), identity.rappid),
    ).toThrow("not canonical");
    expect(() =>
      parseSessionEgg(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(serialized),
        ]),
        identity.rappid,
      ),
    ).toThrow();
  });

  it("matches the frozen current session egg vector exactly", () => {
    const egg = {
      schema: "rapp/1-egg" as const,
      variant: "session" as const,
      rappid: `rappid:@kody/twin:${"a".repeat(64)}`,
      created_utc: "2026-07-15T00:00:00.000Z",
      contents: [] as [],
      payload: {
        runtime: "test",
        transcript: [],
      },
      sig: null,
    };
    expect(serializeSessionEgg(egg)).toBe(
      '{"contents":[],"created_utc":"2026-07-15T00:00:00.000Z","payload":{"runtime":"test","transcript":[]},"rappid":"rappid:@kody/twin:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schema":"rapp/1-egg","sig":null,"variant":"session"}',
    );
    expect(sessionEggAddress(egg)).toBe(
      "8ca5f7815a3a77f60bd442e1b7dc9df9caf3173c23066f8546659bddb756e5a3",
    );
  });

  it("refuses invalid frozen RAPPID and UTC forms", () => {
    const identity = mintKeylessRappid(
      "get-bb",
      "provider-rapp",
      "123e4567-e89b-42d3-a456-426614174000",
    );
    const runtime = {
      provider: "bb/provider-rapp" as const,
      provider_thread_id: "rapp_thread",
      remote_session_id: null,
      turn_counter: 0,
      pending_turn: null,
    };
    expect(() =>
      createSessionEgg({
        rappid: `rappid:@${"a".repeat(40)}/x:${"b".repeat(64)}`,
        createdUtc: "2026-09-02T14:00:00.000Z",
        runtime,
        transcript: [],
      }),
    ).toThrow("rappid");
    expect(() =>
      createSessionEgg({
        rappid: `rappid:@owner/${"a".repeat(101)}:${"b".repeat(64)}`,
        createdUtc: "2026-09-02T14:00:00.000Z",
        runtime,
        transcript: [],
      }),
    ).toThrow("rappid");
    for (const createdUtc of [
      "0000-01-01T00:00:00.000Z",
      "2026-02-29T00:00:00.000Z",
      "2026-04-31T00:00:00.000Z",
      "2026-12-01T24:00:00.000Z",
      "2026-12-01T23:60:00.000Z",
    ]) {
      expect(() =>
        createSessionEgg({
          rappid: identity.rappid,
          createdUtc,
          runtime,
          transcript: [],
        }),
      ).toThrow("UTC");
    }
    expect(
      createSessionEgg({
        rappid: identity.rappid,
        createdUtc: "2028-02-29T23:59:59.999Z",
        runtime,
        transcript: [],
      }).created_utc,
    ).toBe("2028-02-29T23:59:59.999Z");
  });

  it("requires the bridge-private runtime string to be canonical JSON", () => {
    const identity = mintKeylessRappid(
      "get-bb",
      "provider-rapp",
      "123e4567-e89b-42d3-a456-426614174000",
    );
    const egg = {
      schema: "rapp/1-egg" as const,
      variant: "session" as const,
      rappid: identity.rappid,
      created_utc: "2026-09-02T14:00:00.000Z",
      contents: [] as [],
      payload: {
        runtime:
          '{ "provider": "bb/provider-rapp", "provider_thread_id": "rapp_thread", "remote_session_id": null, "turn_counter": 0, "pending_turn": null }',
        transcript: [],
      },
      sig: null,
    };
    expect(() =>
      parseSessionEgg(Buffer.from(serializeSessionEgg(egg)), identity.rappid),
    ).toThrow("runtime is not canonical");
  });
});
