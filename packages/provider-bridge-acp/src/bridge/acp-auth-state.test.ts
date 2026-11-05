import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AcpAuthMethod } from "../client/capabilities.js";
import {
  createAcpAuthStateReader,
  readUncachedAcpAuthState,
  type AcpSessionProbe,
  type AcpSessionProbeOutcome,
  type AcpSignInOptions,
} from "./acp-auth-state.js";

const NODE = { command: process.execPath, args: [] as string[] };

function printing(script: string) {
  return ["-e", script];
}

function commandCheck(
  script: string,
  signedOutText: string[],
  command: string | null = "agent login",
): AcpSignInOptions {
  return {
    command,
    check: { kind: "command", args: printing(script), signedOutText },
  };
}

function sessionCheck(
  signedOutText: string[] = [],
  command: string | null = null,
): AcpSignInOptions {
  return { command, check: { kind: "session", signedOutText } };
}

const terminalMethod: AcpAuthMethod = {
  id: "terminal",
  name: "Set up in terminal",
  type: "terminal",
  args: ["--setup"],
  env: {},
};

const agentMethod: AcpAuthMethod = {
  id: "grok.com",
  name: "Grok",
  type: "agent",
  args: [],
  env: {},
};

const probeOf =
  (outcome: AcpSessionProbeOutcome): AcpSessionProbe =>
  async () =>
    outcome;

const unusedProbe: AcpSessionProbe = async () => {
  throw new Error("a command check must not start the agent");
};

describe("ACP sign-in state", () => {
  it("reads signed out from the status command's own words, on success or failure", async () => {
    await expect(
      readUncachedAcpAuthState({
        agent: NODE,
        signIn: commandCheck(
          "console.log('You are not authenticated.'); console.log('* grok-4.6')",
          ["You are not authenticated"],
          "grok login",
        ),
        probe: unusedProbe,
      }),
    ).resolves.toEqual({
      status: "signedOut",
      loginCommand: "grok login",
    });
    await expect(
      readUncachedAcpAuthState({
        agent: NODE,
        signIn: commandCheck(
          "console.error('No models available. Set API keys.'); process.exit(3)",
          ["no models available"],
          "omp login",
        ),
        probe: unusedProbe,
      }),
    ).resolves.toMatchObject({
      status: "signedOut",
      loginCommand: "omp login",
    });
  });

  it("reports signed in when the status command succeeds without signed-out words", async () => {
    await expect(
      readUncachedAcpAuthState({
        agent: NODE,
        signIn: commandCheck("console.log('opencode/big-pickle')", []),
        probe: unusedProbe,
      }),
    ).resolves.toEqual({ status: "signedIn", loginCommand: "agent login" });
  });

  it("reports an agent that works without an account as signed in without starting it", async () => {
    await expect(
      readUncachedAcpAuthState({
        agent: NODE,
        signIn: { command: "opencode auth login", check: { kind: "none" } },
        probe: unusedProbe,
      }),
    ).resolves.toEqual({
      status: "signedIn",
      loginCommand: "opencode auth login",
    });
  });

  it("does not claim ready when the status command fails for another reason", async () => {
    await expect(
      readUncachedAcpAuthState({
        agent: NODE,
        signIn: commandCheck(
          "console.error('config file is corrupt'); process.exit(2)",
          ["not authenticated"],
        ),
        probe: unusedProbe,
      }),
    ).resolves.toEqual({
      status: "unknown",
      loginCommand: "agent login",
      statusMessage: "config file is corrupt",
    });
  });

  it("prefers the agent's terminal sign-in method over the declared command", async () => {
    const agent = { command: "hermes", args: ["acp"] };
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck([], "hermes model"),
        probe: probeOf({
          kind: "authRequired",
          authMethods: [terminalMethod],
          message: "Authentication required",
        }),
      }),
    ).resolves.toEqual({
      status: "signedOut",
      loginCommand: "hermes acp --setup",
    });
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck([], "hermes model"),
        probe: probeOf({ kind: "session", authMethods: [terminalMethod] }),
      }),
    ).resolves.toEqual({
      status: "signedIn",
      loginCommand: "hermes acp --setup",
    });
  });

  it("uses a legacy terminal-auth command, then the declared command, then names the agent's methods", async () => {
    const agent = { command: "opencode", args: ["acp"] };
    const legacy: AcpAuthMethod = {
      ...agentMethod,
      id: "opencode-login",
      name: "Login with opencode",
      terminalCommand: { command: "opencode", args: ["auth", "login"] },
    };
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck(),
        probe: probeOf({
          kind: "authRequired",
          authMethods: [legacy],
          message: "Authentication required",
        }),
      }),
    ).resolves.toMatchObject({ loginCommand: "opencode auth login" });
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck([], "agent login"),
        probe: probeOf({
          kind: "authRequired",
          authMethods: [agentMethod],
          message: "Authentication required",
        }),
      }),
    ).resolves.toMatchObject({ loginCommand: "agent login" });
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck(),
        probe: probeOf({
          kind: "authRequired",
          authMethods: [agentMethod],
          message: "Authentication required",
        }),
      }),
    ).resolves.toEqual({ status: "signedOut", loginCommand: null });
  });

  it("treats a session failure as signed out only when it carries the agent's signed-out words", async () => {
    const agent = { command: "hermes", args: ["acp"] };
    const failed = probeOf({
      kind: "failed",
      authMethods: [],
      message:
        "Internal error: No LLM provider configured. Run `hermes model` to select a provider.",
    });
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck(["No LLM provider configured"], "hermes model"),
        probe: failed,
      }),
    ).resolves.toMatchObject({
      status: "signedOut",
      loginCommand: "hermes model",
    });
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck(),
        probe: failed,
      }),
    ).resolves.toEqual({
      status: "unknown",
      loginCommand: null,
      statusMessage:
        "Internal error: No LLM provider configured. Run `hermes model` to select a provider.",
    });
    await expect(
      readUncachedAcpAuthState({
        agent,
        signIn: sessionCheck(),
        probe: async () => {
          throw new Error("spawn hermes EACCES");
        },
      }),
    ).resolves.toMatchObject({
      status: "unknown",
      statusMessage: "spawn hermes EACCES",
    });
  });

  it("caches signed-in agents for minutes and signed-out agents briefly, sharing one check at a time", async () => {
    let now = 0;
    let outcome: AcpSessionProbeOutcome = {
      kind: "authRequired",
      authMethods: [],
      message: "Authentication required",
    };
    const probe = vi.fn<AcpSessionProbe>(async () => outcome);
    const reader = createAcpAuthStateReader({ probe, now: () => now });
    const read = () =>
      reader.read({
        agent: { command: "agent", args: [] },
        signIn: sessionCheck(),
      });

    const [first, second] = await Promise.all([read(), read()]);
    expect(first.status).toBe("signedOut");
    expect(second).toBe(first);
    expect(probe).toHaveBeenCalledTimes(1);

    now = 29_000;
    await read();
    expect(probe).toHaveBeenCalledTimes(1);

    outcome = { kind: "session", authMethods: [] };
    now = 31_000;
    expect((await read()).status).toBe("signedIn");
    expect(probe).toHaveBeenCalledTimes(2);

    now = 31_000 + 4 * 60_000;
    await read();
    expect(probe).toHaveBeenCalledTimes(2);

    now = 31_000 + 5 * 60_000 + 1;
    await read();
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("re-checks a signed-out status command sooner than a session probe", async () => {
    let now = 0;
    const reader = createAcpAuthStateReader({
      probe: unusedProbe,
      now: () => now,
    });
    const signIn = commandCheck(
      "require('node:fs').appendFileSync(process.env.LOG, 'x'); console.log('not authenticated')",
      ["not authenticated"],
    );
    const directory = await mkdtemp(path.join(tmpdir(), "bb-acp-auth-"));
    const log = path.join(directory, "runs");
    const agent = { ...NODE, envVars: { LOG: log } };
    try {
      await reader.read({ agent, signIn });
      now = 9_000;
      await reader.read({ agent, signIn });
      expect(await readFile(log, "utf8")).toBe("x");
      now = 10_001;
      expect((await reader.read({ agent, signIn })).status).toBe("signedOut");
      expect(await readFile(log, "utf8")).toBe("xx");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
