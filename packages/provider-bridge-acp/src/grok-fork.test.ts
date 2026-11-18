import { describe, expect, it } from "vitest";
import {
  assertGrokForkIdentity,
  buildGrokForkParams,
  decodeGrokForkResult,
  GrokForkIdentityError,
} from "./grok-fork.js";

const sourceSessionId = "source-session";
const childSessionId = "child-session";

function validResult() {
  return {
    newSessionId: childSessionId,
    chatMessagesCopied: 11,
    updatesCopied: 7,
    planStateCopied: false,
    newCwd: "/tmp/target",
    parentSessionId: sourceSessionId,
  };
}

describe("Grok fork protocol", () => {
  it("builds exact fork params and decodes a valid result", () => {
    expect(
      buildGrokForkParams({
        sourceSessionId,
        sourceCwd: "/tmp/source",
        newCwd: "/tmp/target",
        mcpServers: [{ name: "bb" }],
      }),
    ).toEqual({
      sourceSessionId,
      sourceCwd: "/tmp/source",
      newCwd: "/tmp/target",
      mcpServers: [{ name: "bb" }],
    });
    expect(decodeGrokForkResult(validResult())).toEqual(validResult());
  });

  it("allows an empty copied history and unknown future fields", () => {
    expect(
      decodeGrokForkResult({
        newSessionId: childSessionId,
        parentSessionId: sourceSessionId,
        newCwd: "/tmp/target",
        chatMessagesCopied: 0,
        updatesCopied: 0,
        futureField: { tolerated: true },
      }),
    ).toMatchObject({
      newSessionId: childSessionId,
      parentSessionId: sourceSessionId,
      chatMessagesCopied: 0,
      updatesCopied: 0,
      futureField: { tolerated: true },
    });
  });

  it("preserves Unicode cwd values", () => {
    const result = { ...validResult(), newCwd: "/tmp/Проект 😀" };
    expect(decodeGrokForkResult(result).newCwd).toBe("/tmp/Проект 😀");
  });

  it("rejects a child that reuses the source identity", () => {
    expect(() =>
      assertGrokForkIdentity(
        decodeGrokForkResult({
          ...validResult(),
          newSessionId: sourceSessionId,
        }),
        sourceSessionId,
        [],
      ),
    ).toThrow(GrokForkIdentityError);
  });

  it("rejects a child that reuses another active identity", () => {
    expect(() =>
      assertGrokForkIdentity(
        decodeGrokForkResult(validResult()),
        sourceSessionId,
        [childSessionId],
      ),
    ).toThrow(/active|already|collision/i);
  });

  it("rejects incorrect parent linkage", () => {
    expect(() =>
      assertGrokForkIdentity(
        decodeGrokForkResult({
          ...validResult(),
          parentSessionId: "different-parent",
        }),
        sourceSessionId,
        [],
      ),
    ).toThrow(/parent/i);
  });

  it("rejects malformed identities and negative copy counts", () => {
    expect(() =>
      decodeGrokForkResult({ ...validResult(), newSessionId: "" }),
    ).toThrow(/newSessionId/);
    expect(() =>
      decodeGrokForkResult({ ...validResult(), chatMessagesCopied: -1 }),
    ).toThrow(/chatMessagesCopied/);
    expect(() =>
      decodeGrokForkResult({ ...validResult(), updatesCopied: -1 }),
    ).toThrow(/updatesCopied/);
  });

  it("keeps concurrent fork results independent", () => {
    const first = decodeGrokForkResult(validResult());
    const second = decodeGrokForkResult({
      ...validResult(),
      newSessionId: "second-child",
    });

    expect(first.newSessionId).toBe(childSessionId);
    expect(second.newSessionId).toBe("second-child");
    expect(first).not.toBe(second);
    expect(() =>
      assertGrokForkIdentity(first, sourceSessionId, [second.newSessionId]),
    ).not.toThrow();
    expect(() =>
      assertGrokForkIdentity(second, sourceSessionId, [first.newSessionId]),
    ).not.toThrow();
  });
});
