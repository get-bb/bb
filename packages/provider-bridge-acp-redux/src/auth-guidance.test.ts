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
        platform: "linux",
      }),
    ).toBe(
      "To sign in, run this in a terminal on the machine that hosts the thread, then send the message again: AGENT_LOGIN=1 NOTE='two words' '/opt/my agent/bin/agent' acp --profile 'it'\\''s mine' login --device",
    );
  });

  it("writes the command for a Windows terminal: paths stay bare, words with spaces take double quotes", () => {
    const terminal = {
      id: "terminal",
      name: "Log in",
      type: "terminal",
      args: ["login", "--device"],
      env: {},
    };
    expect(
      describeAcpSignIn({
        command: "C:\\Tools\\node\\node.exe",
        args: ["C:\\Users\\me\\agent.mjs"],
        authMethods: [terminal],
        platform: "win32",
      }),
    ).toMatch(
      /again: C:\\Tools\\node\\node\.exe C:\\Users\\me\\agent\.mjs login --device$/u,
    );
    expect(
      describeAcpSignIn({
        command: "C:\\Program Files\\Agent\\agent.exe",
        args: ["--profile", "it's mine"],
        authMethods: [{ ...terminal, env: { NOTE: "two words" } }],
        platform: "win32",
      }),
    ).toMatch(
      /again: \$env:NOTE="two words"; "C:\\Program Files\\Agent\\agent\.exe" --profile "it's mine" login --device$/u,
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
