import { describe, expect, it } from "vitest";
import { applyAcpAgentProbe } from "./probe-capabilities.js";
import type { AcpAgentDefinition } from "./agents.js";

function agent(fork: AcpAgentDefinition["fork"]): AcpAgentDefinition {
  return {
    id: "acp-grok",
    displayName: "Grok Build",
    fork,
    launch: {
      displayName: "Grok Build",
      command: "grok",
      args: ["agent", "stdio"],
      env: {},
    },
  };
}

describe("applyAcpAgentProbe", () => {
  it("preserves Grok tip fork when the extension probe succeeds", () => {
    expect(
      applyAcpAgentProbe(agent("tip"), {
        reachable: true,
        fork: false,
        extensionFork: true,
      }),
    ).toBeNull();
  });

  it("narrows Grok tip fork when the extension probe fails", () => {
    expect(
      applyAcpAgentProbe(agent("tip"), {
        reachable: true,
        fork: false,
        extensionFork: false,
      }),
    ).toEqual({
      agent: { ...agent("tip"), fork: "none" },
      reason:
        'the agent does not advertise session/fork, but bb declared fork "tip"',
    });
  });

  it("narrows checkpoint fork when no compatible fork is advertised", () => {
    expect(
      applyAcpAgentProbe(agent("checkpoint"), {
        reachable: true,
        fork: false,
      }),
    ).toEqual({
      agent: { ...agent("checkpoint"), fork: "none" },
      reason:
        'the agent does not advertise session/fork, but bb declared fork "checkpoint"',
    });
  });

  it("does nothing when the agent is unreachable", () => {
    expect(
      applyAcpAgentProbe(agent("tip"), {
        reachable: false,
        reason: "missing",
      }),
    ).toBeNull();
  });
});
