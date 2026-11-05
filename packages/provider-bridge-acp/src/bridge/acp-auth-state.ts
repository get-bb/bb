import { execPortableFile } from "@bb/process-utils";
import { withoutBridgeRuntimeEnv } from "@bb/provider-bridge-protocol/bridge-kit";
import { z } from "zod";
import { resolveAcpSignInCommand } from "../auth-guidance.js";
import type { AcpAuthMethod } from "../client/capabilities.js";
import type { AcpAgentCommandParam } from "../session-params.js";

const STATUS_COMMAND_TIMEOUT_MS = 15_000;
const SIGNED_IN_TTL_MS = 5 * 60_000;
const UNSETTLED_COMMAND_TTL_MS = 10_000;
const UNSETTLED_SESSION_TTL_MS = 30_000;
const MAX_STATUS_DETAIL_LENGTH = 300;

export const acpSignInOptionsSchema = z
  .object({
    command: z.string().min(1).nullable(),
    check: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("command"),
          args: z.array(z.string()),
          signedOutText: z.array(z.string().min(1)),
        })
        .strict(),
      z
        .object({
          kind: z.literal("session"),
          signedOutText: z.array(z.string().min(1)),
        })
        .strict(),
      z.object({ kind: z.literal("none") }).strict(),
    ]),
  })
  .strict();
export type AcpSignInOptions = z.infer<typeof acpSignInOptionsSchema>;

export const DEFAULT_ACP_SIGN_IN_OPTIONS: AcpSignInOptions = {
  command: null,
  check: { kind: "session", signedOutText: [] },
};

export type AcpSessionProbeOutcome =
  | { kind: "session"; authMethods: readonly AcpAuthMethod[] }
  | {
      kind: "authRequired";
      authMethods: readonly AcpAuthMethod[];
      message: string;
    }
  | { kind: "failed"; authMethods: readonly AcpAuthMethod[]; message: string };

export type AcpSessionProbe = (
  agent: AcpAgentCommandParam,
) => Promise<AcpSessionProbeOutcome>;

export type AcpAuthState =
  | { status: "signedIn"; loginCommand: string | null }
  | { status: "signedOut"; loginCommand: string | null }
  | {
      status: "unknown";
      loginCommand: string | null;
      statusMessage: string | null;
    };

export interface AcpAuthStateReader {
  read(args: {
    agent: AcpAgentCommandParam;
    signIn: AcpSignInOptions;
  }): Promise<AcpAuthState>;
}

function mentionsSignedOut(
  signedOutText: readonly string[],
  ...texts: readonly string[]
): boolean {
  const haystack = texts.join("\n").toLowerCase();
  return signedOutText.some((text) => haystack.includes(text.toLowerCase()));
}

function firstLine(text: string): string {
  const line =
    text
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry !== "") ?? "";
  return line.length > MAX_STATUS_DETAIL_LENGTH
    ? `${line.slice(0, MAX_STATUS_DETAIL_LENGTH)}…`
    : line;
}

function signedOut(args: {
  agent: AcpAgentCommandParam;
  signIn: AcpSignInOptions;
  authMethods: readonly AcpAuthMethod[];
}): AcpAuthState {
  return {
    status: "signedOut",
    loginCommand: resolveAcpSignInCommand({
      command: args.agent.command,
      args: args.agent.args,
      authMethods: args.authMethods,
      declaredCommand: args.signIn.command,
    }),
  };
}

const commandFailureSchema = z.object({
  stdout: z.string().default(""),
  stderr: z.string().default(""),
});

async function readCommandAuthState(
  agent: AcpAgentCommandParam,
  signIn: AcpSignInOptions,
  check: { args: string[]; signedOutText: string[] },
): Promise<AcpAuthState> {
  try {
    const { stdout, stderr } = await execPortableFile(
      agent.command,
      check.args,
      {
        cwd: agent.cwd ?? process.cwd(),
        env: {
          ...withoutBridgeRuntimeEnv(process.env),
          ...(agent.envVars ?? {}),
        },
        maxBuffer: 1024 * 1024,
        timeout: STATUS_COMMAND_TIMEOUT_MS,
      },
    );
    return mentionsSignedOut(check.signedOutText, stdout, stderr)
      ? signedOut({ agent, signIn, authMethods: [] })
      : { status: "signedIn", loginCommand: signIn.command };
  } catch (error) {
    const output = commandFailureSchema.safeParse(error);
    const stdout = output.success ? output.data.stdout : "";
    const stderr = output.success ? output.data.stderr : "";
    if (mentionsSignedOut(check.signedOutText, stdout, stderr)) {
      return signedOut({ agent, signIn, authMethods: [] });
    }
    const detail =
      firstLine(stderr) ||
      firstLine(stdout) ||
      (error instanceof Error ? firstLine(error.message) : "");
    return {
      status: "unknown",
      loginCommand: signIn.command,
      statusMessage: detail === "" ? null : detail,
    };
  }
}

async function readSessionAuthState(
  agent: AcpAgentCommandParam,
  signIn: AcpSignInOptions,
  signedOutText: readonly string[],
  probe: AcpSessionProbe,
): Promise<AcpAuthState> {
  const outcome = await probe(agent).catch(
    (error: unknown): AcpSessionProbeOutcome => ({
      kind: "failed",
      authMethods: [],
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  if (outcome.kind === "session") {
    return {
      status: "signedIn",
      loginCommand: resolveAcpSignInCommand({
        command: agent.command,
        args: agent.args,
        authMethods: outcome.authMethods,
        declaredCommand: signIn.command,
      }),
    };
  }
  if (
    outcome.kind === "authRequired" ||
    mentionsSignedOut(signedOutText, outcome.message)
  ) {
    return signedOut({ agent, signIn, authMethods: outcome.authMethods });
  }
  return {
    status: "unknown",
    loginCommand: resolveAcpSignInCommand({
      command: agent.command,
      args: agent.args,
      authMethods: outcome.authMethods,
      declaredCommand: signIn.command,
    }),
    statusMessage: firstLine(outcome.message) || null,
  };
}

export function readUncachedAcpAuthState(args: {
  agent: AcpAgentCommandParam;
  signIn: AcpSignInOptions;
  probe: AcpSessionProbe;
}): Promise<AcpAuthState> {
  const { check } = args.signIn;
  switch (check.kind) {
    case "none":
      return Promise.resolve({
        status: "signedIn",
        loginCommand: args.signIn.command,
      });
    case "command":
      return readCommandAuthState(args.agent, args.signIn, check);
    case "session":
      return readSessionAuthState(
        args.agent,
        args.signIn,
        check.signedOutText,
        args.probe,
      );
  }
}

export function createAcpAuthStateReader(options: {
  probe: AcpSessionProbe;
  now?: () => number;
}): AcpAuthStateReader {
  const now = options.now ?? Date.now;
  const settled = new Map<string, { state: AcpAuthState; expiresAt: number }>();
  const pending = new Map<string, Promise<AcpAuthState>>();
  return {
    read({ agent, signIn }) {
      const key = JSON.stringify({ agent, signIn });
      const cached = settled.get(key);
      if (cached !== undefined && cached.expiresAt > now()) {
        return Promise.resolve(cached.state);
      }
      const running = pending.get(key);
      if (running !== undefined) {
        return running;
      }
      const started = readUncachedAcpAuthState({
        agent,
        signIn,
        probe: options.probe,
      })
        .then((state) => {
          settled.set(key, {
            state,
            expiresAt:
              now() +
              (state.status === "signedIn"
                ? SIGNED_IN_TTL_MS
                : signIn.check.kind === "command"
                  ? UNSETTLED_COMMAND_TTL_MS
                  : UNSETTLED_SESSION_TTL_MS),
          });
          return state;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, started);
      return started;
    },
  };
}
