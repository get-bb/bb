import { describe, expect, it } from "vitest";
import type { AcpAgentDefinition } from "./agents.js";
import type { AcpProbeResult } from "./contract.js";
import { applyAcpAgentProbe } from "./probe-capabilities.js";

const agent = (fork?: "none" | "tip"): AcpAgentDefinition => {
  const definition: AcpAgentDefinition = {
    id: "acp-example",
    displayName: "Example",
    launch: { displayName: "Example", command: "example", args: [], env: {} },
  };
  if (fork !== undefined) definition.fork = fork;
  return definition;
};

const reachable = (fork: boolean): AcpProbeResult => ({
  reachable: true,
  fork,
});

describe("applyAcpAgentProbe", () => {
  it("narrows a fork the agent does not advertise", () => {
    const applied = applyAcpAgentProbe(agent("tip"), reachable(false));
    expect(applied?.agent.fork).toBe("none");
    expect(applied?.reason).toContain("does not advertise session/fork");
  });

  it("changes nothing when the agent answers what bb declared", () => {
    expect(applyAcpAgentProbe(agent("tip"), reachable(true))).toBeNull();
    expect(applyAcpAgentProbe(agent("none"), reachable(false))).toBeNull();
  });

  it("does not offer a fork bb never declared", () => {
    expect(applyAcpAgentProbe(agent("none"), reachable(true))).toBeNull();
    expect(applyAcpAgentProbe(agent(), reachable(true))).toBeNull();
  });

  it("leaves an unreachable agent alone", () => {
    expect(
      applyAcpAgentProbe(agent("tip"), {
        reachable: false,
        reason: "spawn example ENOENT",
      }),
    ).toBeNull();
  });
});
