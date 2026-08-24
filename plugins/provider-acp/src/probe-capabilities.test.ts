import { describe, expect, it } from "vitest";
import type { AcpAgentDefinition } from "./agents.js";
import type { AcpProbeResult } from "./contract.js";
import { applyAcpAgentProbe } from "./probe-capabilities.js";

const agent = (fork?: "none" | "tip"): AcpAgentDefinition => ({
  id: "acp-example",
  displayName: "Example",
  launch: { displayName: "Example", command: "example", args: [], env: {} },
  ...(fork === undefined ? {} : { fork }),
});

const reachable = (fork: boolean): AcpProbeResult => ({
  reachable: true,
  fork,
});

describe("applyAcpAgentProbe", () => {
  // #1833: a declaration above what the agent answers makes POST
  // /threads/fork create a thread that dies on start.
  it("narrows a fork the agent does not advertise", () => {
    const applied = applyAcpAgentProbe(agent("tip"), reachable(false));
    expect(applied?.agent.fork).toBe("none");
    expect(applied?.reason).toContain("does not advertise session/fork");
  });

  it("changes nothing when the agent answers what bb declared", () => {
    expect(applyAcpAgentProbe(agent("tip"), reachable(true))).toBeNull();
    expect(applyAcpAgentProbe(agent("none"), reachable(false))).toBeNull();
  });

  // Never widen: bb has verified the agent's own answer, not that its fork
  // works end to end through the bridge, the runtime and the timeline.
  it("does not offer a fork bb never declared", () => {
    expect(applyAcpAgentProbe(agent("none"), reachable(true))).toBeNull();
    expect(applyAcpAgentProbe(agent(), reachable(true))).toBeNull();
  });

  // An agent that is not installed on this host, or a host that cannot be
  // reached, must leave the declaration exactly as it is.
  it("leaves an unreachable agent alone", () => {
    expect(
      applyAcpAgentProbe(agent("tip"), {
        reachable: false,
        reason: "spawn example ENOENT",
      }),
    ).toBeNull();
  });
});
