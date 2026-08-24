/**
 * What one installed ACP agent can actually do (Q21).
 *
 * A provider declaration states its capabilities before any agent has spoken,
 * so bb declared one answer for every ACP agent and got them wrong: the ACP
 * tier offered `session/fork` for five agents, of which the two bb has since
 * read the wire for support none of it. A declaration above what the agent
 * answers is not a missing feature — the bridge refuses the fork only after
 * bb created the fork thread, so the thread dies on start (get-bb/bb#1833).
 *
 * The agent already reports the truth: `initialize` returns
 * `agentCapabilities`. This probe asks it. It runs on the host, because the
 * agent is a host-local executable, and it is deliberately cheap and
 * disposable: spawn, initialize, read the reply, kill. It never starts a
 * session and never prompts.
 */

import { z } from "zod";
import { withoutBridgeRuntimeEnv } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  AcpAgentExitedError,
  createAcpAgentConnection,
} from "./bridge/agent-connection.js";
import { ACP_PROTOCOL_VERSION, acpInitializeResultSchema } from "./wire.js";

/** How long the whole probe may take before bb gives up on the agent. */
const PROBE_TIMEOUT_MS = 10_000;

export interface AcpAgentProbeRequest {
  command: string;
  args: readonly string[];
  /** Extra environment the agent's launch spec asks for. */
  env?: Record<string, string>;
  /** Where to run the probe; the agent may refuse to start without one. */
  cwd: string;
  timeoutMs?: number;
}

/** What the agent said about itself, or why bb could not ask. */
export type AcpAgentProbe =
  | {
      reachable: true;
      /** The agent implements the unstable `session/fork`. */
      fork: boolean;
    }
  | { reachable: false; reason: string };

function describe(error: unknown): string {
  if (error instanceof AcpAgentExitedError) {
    return `the agent exited before it answered initialize: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ask one agent what it supports. Never throws: an agent that is missing,
 * broken, or too slow is a `reachable: false` answer with the reason, which
 * the caller reports as "bb could not verify this agent" rather than as a
 * capability.
 */
export async function probeAcpAgent(
  request: AcpAgentProbeRequest,
): Promise<AcpAgentProbe> {
  const timeoutMs = request.timeoutMs ?? PROBE_TIMEOUT_MS;
  let connection: ReturnType<typeof createAcpAgentConnection> | undefined;
  try {
    connection = createAcpAgentConnection({
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      // The same environment the bridge would launch this agent in. Raw
      // process.env would hand the agent ELECTRON_RUN_AS_NODE (the packaged
      // daemon runs in electron-node mode) and the record-dir variable, so a
      // probed agent would run somewhere its real launch never does.
      env: withoutBridgeRuntimeEnv({ ...process.env, ...(request.env ?? {}) }),
      recordThreadId: null,
      onNotification: () => {},
      // A probe is not a session: an agent that asks the client anything
      // before initialize returns gets a plain "not supported".
      onRequest: (_method, _params, responder) => {
        responder.error(-32601, "bb is probing this agent's capabilities");
      },
      onExit: () => {},
    });
  } catch (error) {
    return { reachable: false, reason: describe(error) };
  }

  const connected = connection;
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(`the agent did not answer initialize within ${timeoutMs}ms`),
        ),
      timeoutMs,
    ).unref?.();
  });

  try {
    const result = await Promise.race([
      connected.request({
        method: "initialize",
        params: {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientInfo: { name: "bb", version: "1.0.0" },
          // The probe advertises what bb's bridge advertises, so an agent
          // that varies its capabilities by client sees the same client.
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: false,
          },
        },
        resultSchema: acpInitializeResultSchema,
      }),
      timeout,
    ]);
    return {
      reachable: true,
      fork: result.agentCapabilities?.sessionCapabilities?.fork != null,
    };
  } catch (error) {
    return { reachable: false, reason: describe(error) };
  } finally {
    connected.kill();
  }
}

export const acpAgentProbeSchema: z.ZodType<AcpAgentProbe> = z.union([
  z.object({ reachable: z.literal(true), fork: z.boolean() }),
  z.object({ reachable: z.literal(false), reason: z.string() }),
]);
