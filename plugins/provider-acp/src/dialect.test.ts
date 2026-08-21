import { describe, expect, it } from "vitest";
import {
  GENERIC_ACP_DIALECT,
  GROK_ACP_DIALECT,
  resolveAcpDialect,
} from "./dialect.js";

describe("resolveAcpDialect", () => {
  it("keys on the launch executable's base name", () => {
    expect(resolveAcpDialect({ command: "grok" })).toBe(GROK_ACP_DIALECT);
    expect(resolveAcpDialect({ command: "/usr/local/bin/grok" })).toBe(
      GROK_ACP_DIALECT,
    );
  });

  it("gives an unknown agent the generic dialect", () => {
    expect(resolveAcpDialect({ command: "cursor-agent" })).toBe(
      GENERIC_ACP_DIALECT,
    );
    expect(GENERIC_ACP_DIALECT.toolIdentity).toBeUndefined();
  });
});

describe("grok dialect", () => {
  const identity = (meta: unknown) =>
    GROK_ACP_DIALECT.toolIdentity?.({
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      _meta: meta,
    } as Parameters<NonNullable<typeof GROK_ACP_DIALECT.toolIdentity>>[0]);

  it("reads the tool name and kind from x.ai/tool", () => {
    expect(
      identity({
        "x.ai/tool": {
          version: 1,
          name: "run_terminal_command",
          kind: "execute",
          namespace: "grok_build",
        },
      }),
    ).toEqual({ name: "run_terminal_command", kind: "execute" });
  });

  // The side channel is the vendor's, so it is read defensively: a kind bb's
  // vocabulary does not have is no kind at all, and a call with no _meta
  // leaves every decision to the protocol fields.
  it("ignores a kind outside the ACP vocabulary and a missing _meta", () => {
    expect(
      identity({ "x.ai/tool": { name: "deploy_thing", kind: "deploy" } }),
    ).toEqual({ name: "deploy_thing" });
    expect(identity(undefined)).toBeUndefined();
    expect(identity({ "other.vendor/tool": { name: "x" } })).toBeUndefined();
  });
});
