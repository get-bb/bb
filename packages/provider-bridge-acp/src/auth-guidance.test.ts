import { describe, expect, it } from "vitest";
import { describeAcpSignIn } from "./auth-guidance.js";

const agentMethod = (name: string) => ({
  id: name.toLowerCase(),
  name,
  type: "agent",
  args: [],
  env: {},
});

describe("ACP sign-in guidance", () => {
  it("gives the exact command for a terminal sign-in method, quoting what a shell would split", () => {
    expect(
      describeAcpSignIn({
        command: "/opt/my agent/bin/agent",
        args: ["acp", "--profile", "it's mine"],
        authMethods: [
          agentMethod("Browser"),
          {
            id: "terminal",
            name: "Log in",
            type: "terminal",
            args: ["login", "--device"],
            env: { AGENT_LOGIN: "1", NOTE: "two words" },
          },
        ],
      }),
    ).toBe(
      "To sign in, run this in a terminal on the machine that hosts the thread, then send the message again: AGENT_LOGIN=1 NOTE='two words' '/opt/my agent/bin/agent' acp --profile 'it'\\''s mine' login --device",
    );
  });

  it("names the agent's own methods when none of them is a terminal command", () => {
    expect(
      describeAcpSignIn({
        command: "agent",
        args: [],
        authMethods: [
          agentMethod("Browser login"),
          agentMethod("API key"),
          agentMethod("Browser login"),
        ],
      }),
    ).toBe(
      "The agent offers these ways to sign in: Browser login, API key. Sign in with the agent's own command on the machine that hosts the thread, then send the message again.",
    );
    expect(
      describeAcpSignIn({
        command: "agent",
        args: [],
        authMethods: ["A", "B", "C", "D", "E", "F"].map(agentMethod),
      }),
    ).toContain("A, B, C, D and 2 more.");
  });

  it("says nothing when the agent advertised no usable method", () => {
    expect(
      describeAcpSignIn({ command: "agent", args: [], authMethods: [] }),
    ).toBeNull();
    expect(
      describeAcpSignIn({
        command: "agent",
        args: [],
        authMethods: [agentMethod(" ")],
      }),
    ).toBeNull();
  });
});
