import {
  LEGACY_SYSTEM_ACTOR_STAMP,
  SYSTEM_ACTOR_STAMP,
  actorStampsEqual,
  type ActorStamp,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  decodeActorStampFromColumns,
  encodeActorStampColumns,
} from "../src/actor-stamp-columns.js";

describe("ActorStamp column encoding", () => {
  it("round-trips a complete stamp", () => {
    const stamp: ActorStamp = {
      principalId: "human:alice",
      principalKind: "human",
      displayName: "Alice",
    };
    const columns = encodeActorStampColumns(stamp);
    expect(columns).toEqual({
      actorPrincipalId: "human:alice",
      actorKind: "human",
      actorDisplayName: "Alice",
    });
    expect(decodeActorStampFromColumns(columns)).toEqual(stamp);
  });

  it("maps an all-null legacy triple to an explicit system actor", () => {
    const decoded = decodeActorStampFromColumns({
      actorPrincipalId: null,
      actorKind: null,
      actorDisplayName: null,
    });
    expect(decoded).toEqual(LEGACY_SYSTEM_ACTOR_STAMP);
    expect(actorStampsEqual(decoded, SYSTEM_ACTOR_STAMP)).toBe(false);
  });

  it("fails closed on partial or corrupt triples", () => {
    const invalid = [
      ["human:1", null, null],
      [null, "human", null],
      [null, null, "Alice"],
      ["human:1", "human", null],
      ["human:1", "not-a-kind", "Alice"],
      ["", "human", "Alice"],
    ] as const;
    for (const [actorPrincipalId, actorKind, actorDisplayName] of invalid) {
      expect(() =>
        decodeActorStampFromColumns({
          actorPrincipalId,
          actorKind,
          actorDisplayName,
        }),
      ).toThrow();
    }
  });
});
