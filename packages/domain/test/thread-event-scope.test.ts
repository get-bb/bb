import { describe, expect, it } from "vitest";
import {
  requireThreadEventScopeTurnId,
  threadEventScopeSchema,
  threadScope,
  turnScope,
  validateThreadEventScope,
} from "../src/index.js";

describe("thread event scope policy", () => {
  it("rejects invalid scope at runtime", () => {
    expect(
      validateThreadEventScope({
        type: "item/completed",
        scope: threadScope(),
      }),
    ).toEqual({
      valid: false,
      message: "item/completed requires turn scope but received thread scope",
    });
  });

  it("allows thread-or-turn events to use either explicit scope", () => {
    expect(
      validateThreadEventScope({
        type: "provider/unhandled",
        scope: threadScope(),
      }),
    ).toEqual({ valid: true });
    expect(
      validateThreadEventScope({
        type: "provider/unhandled",
        scope: turnScope("turn-1"),
      }),
    ).toEqual({ valid: true });
    expect(
      validateThreadEventScope({
        type: "system/operation",
        scope: threadScope(),
      }),
    ).toEqual({ valid: true });
    expect(
      validateThreadEventScope({
        type: "system/operation",
        scope: turnScope("turn-1"),
      }),
    ).toEqual({ valid: true });
  });

  it("returns the canonical turn id for turn-scoped events", () => {
    expect(
      requireThreadEventScopeTurnId({
        type: "turn/started",
        scope: turnScope("turn-1"),
      }),
    ).toBe("turn-1");
  });

  it("rejects empty turn ids at the schema boundary", () => {
    expect(threadEventScopeSchema.safeParse(turnScope("")).success).toBe(false);
  });

  it("throws when canonical turn id is requested from thread scope", () => {
    expect(() =>
      requireThreadEventScopeTurnId({
        type: "turn/started",
        scope: threadScope(),
      }),
    ).toThrow("turn/started requires turn scope but received thread scope");
  });
});
