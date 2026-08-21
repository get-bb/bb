import { describe, expect, it } from "vitest";
import { acpAgentProbeSchema, probeAcpAgent } from "./probe.js";

describe("probeAcpAgent", () => {
  // An agent that is not installed is the common case on any host, and it
  // must never throw: a probe failure is an answer, not an error.
  it("reports a missing agent instead of throwing", async () => {
    const probe = await probeAcpAgent({
      command: "bb-acp-agent-that-does-not-exist",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });

    expect(probe.reachable).toBe(false);
    expect(probe.reachable === false && probe.reason).toContain("ENOENT");
    expect(acpAgentProbeSchema.safeParse(probe).success).toBe(true);
  });

  it("gives up on an agent that never answers initialize", async () => {
    const probe = await probeAcpAgent({
      // An agent that starts, holds its stdin open, and answers nothing —
      // the failure the timeout exists for. (`cat` would not do: it echoes
      // the request back, which is a different, answered conversation.)
      command: process.execPath,
      args: ["-e", "process.stdin.resume();"],
      cwd: process.cwd(),
      timeoutMs: 300,
    });

    expect(probe).toEqual({
      reachable: false,
      reason: "the agent did not answer initialize within 300ms",
    });
  });

  it("reads the capabilities an agent reports", async () => {
    const probe = await probeAcpAgent({
      command: process.execPath,
      args: [
        "-e",
        `process.stdin.on("data", () => {
           process.stdout.write(JSON.stringify({
             jsonrpc: "2.0",
             id: 1,
             result: {
               protocolVersion: 1,
               agentCapabilities: {
                 loadSession: true,
                 sessionCapabilities: { fork: {} },
                 promptCapabilities: { image: true },
               },
               authMethods: [{ id: "token" }],
             },
           }) + "\\n");
         });`,
      ],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    expect(probe).toEqual({
      reachable: true,
      protocolVersion: 1,
      fork: true,
      loadSession: true,
      promptImage: true,
      authMethods: ["token"],
    });
  });
});
