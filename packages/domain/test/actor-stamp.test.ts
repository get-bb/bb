import { describe, expect, it } from "vitest";
import {
  actorStampSchema,
  parseActorStamp,
  type ActorStamp,
} from "../src/actor-stamp.js";
import { principalKindValues } from "../src/principal.js";

describe("ActorStamp schema", () => {
  it("accepts all principal kinds with non-empty fields", () => {
    for (const principalKind of principalKindValues) {
      const stamp: ActorStamp = {
        principalId: `${principalKind}:test-id`,
        principalKind,
        displayName: `Display ${principalKind}`,
      };
      expect(parseActorStamp(stamp)).toEqual(stamp);
      expect(actorStampSchema.safeParse(stamp).success).toBe(true);
    }
  });

  it("rejects empty principalId, displayName, unknown kind, and extra keys", () => {
    expect(
      actorStampSchema.safeParse({
        principalId: "",
        principalKind: "human",
        displayName: "Alice",
      }).success,
    ).toBe(false);
    expect(
      actorStampSchema.safeParse({
        principalId: "human:1",
        principalKind: "human",
        displayName: "",
      }).success,
    ).toBe(false);
    expect(
      actorStampSchema.safeParse({
        principalId: "human:1",
        principalKind: "visitor",
        displayName: "Alice",
      }).success,
    ).toBe(false);
    expect(
      actorStampSchema.safeParse({
        principalId: "human:1",
        principalKind: "human",
        displayName: "Alice",
        handle: "alice",
      }).success,
    ).toBe(false);
  });
});
