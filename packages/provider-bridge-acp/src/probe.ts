import { z } from "zod";
import {
  buildProviderCliEnv,
  withoutBridgeRuntimeEnv,
} from "@bb/provider-bridge-protocol/bridge-kit";
import {
  AcpAgentExitedError,
  createAcpAgentConnection,
  requestAcpInitialize,
  type AcpAgentConnection,
} from "./bridge/agent-connection.js";
import type { AcpAgentCapabilities } from "./client/capabilities.js";
import {
  assertGrokForkIdentity,
  buildGrokForkParams,
  decodeGrokForkResult,
} from "./grok-fork.js";
import { acpSessionNewResultSchema } from "./wire.js";

const PROBE_TIMEOUT_MS = 10_000;

export interface AcpAgentProbeRequest {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  cwd: string;
  timeoutMs?: number;
  grokFork?: boolean;
}

export type AcpAgentProbe =
  | {
      reachable: true;
      fork: boolean;
      extensionFork?: boolean;
    }
  | { reachable: false; reason: string };

function describe(error: unknown): string {
  if (error instanceof AcpAgentExitedError) {
    return `the agent exited before it answered initialize: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function grokAuthMethodId(
  capabilities: AcpAgentCapabilities,
  env: Record<string, string | undefined>,
): string | undefined {
  const methodIds = new Set(
    capabilities.authMethods.map((method) => method.id),
  );
  if (env.XAI_API_KEY && methodIds.has("xai.api_key")) {
    return "xai.api_key";
  }
  return methodIds.has("cached_token") ? "cached_token" : undefined;
}

async function closeProbeSessions(
  connection: AcpAgentConnection,
  capabilities: AcpAgentCapabilities,
  sessionIds: readonly string[],
): Promise<void> {
  if (!capabilities.session.close) {
    return;
  }
  for (const sessionId of sessionIds) {
    try {
      await connection.request({
        method: "session/close",
        params: { sessionId },
        resultSchema: z.unknown(),
        timeoutMs: 5_000,
      });
    } catch {}
  }
}

async function probeGrokExtensionFork(
  connection: AcpAgentConnection,
  capabilities: AcpAgentCapabilities,
  request: AcpAgentProbeRequest,
): Promise<AcpAgentProbe> {
  const env = withoutBridgeRuntimeEnv({
    ...process.env,
    ...(request.env ?? {}),
  });
  const sessionIds: string[] = [];
  try {
    let createdSessionId: string;
    try {
      const methodId = grokAuthMethodId(capabilities, env);
      if (methodId !== undefined) {
        await connection.request({
          method: "authenticate",
          params: { methodId, _meta: { headless: true } },
          resultSchema: z.unknown(),
          timeoutMs: request.timeoutMs ?? PROBE_TIMEOUT_MS,
        });
      }
      const created = await connection.request({
        method: "session/new",
        params: { cwd: request.cwd, mcpServers: [] },
        resultSchema: acpSessionNewResultSchema,
        timeoutMs: request.timeoutMs ?? PROBE_TIMEOUT_MS,
      });
      createdSessionId = created.sessionId;
      sessionIds.push(created.sessionId);
    } catch (error) {
      return { reachable: false, reason: describe(error) };
    }
    try {
      const result = decodeGrokForkResult(
        await connection.request({
          method: "_x.ai/session/fork",
          params: buildGrokForkParams({
            sourceSessionId: createdSessionId,
            sourceCwd: request.cwd,
            newCwd: request.cwd,
            mcpServers: [],
          }),
          resultSchema: z.unknown(),
          timeoutMs: request.timeoutMs ?? PROBE_TIMEOUT_MS,
        }),
      );
      assertGrokForkIdentity(result, createdSessionId, [createdSessionId]);
      sessionIds.push(result.newSessionId);
      return {
        reachable: true,
        fork: capabilities.session.fork,
        extensionFork: true,
      };
    } catch {
      return {
        reachable: true,
        fork: capabilities.session.fork,
        extensionFork: false,
      };
    }
  } finally {
    await closeProbeSessions(connection, capabilities, sessionIds);
  }
}

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
      env: buildProviderCliEnv(request.env),
      recordThreadId: null,
      onNotification: () => {},
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
          new Error(
            `the agent did not answer initialize within ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    ).unref?.();
  });

  try {
    const result = await Promise.race([
      requestAcpInitialize(connected, {
        parameterizedModelPicker: false,
        fsAccess: true,
      }),
      timeout,
    ]);
    return request.grokFork === true
      ? await probeGrokExtensionFork(connected, result, request)
      : {
          reachable: true,
          fork: result.session.fork,
        };
  } catch (error) {
    return { reachable: false, reason: describe(error) };
  } finally {
    void connected.kill().catch((error: unknown) => {
      process.stderr.write(
        `acp probe: stopping "${request.command}" failed: ${describe(error)}\n`,
      );
    });
  }
}

export const acpAgentProbeSchema: z.ZodType<AcpAgentProbe> = z.union([
  z.object({
    reachable: z.literal(true),
    fork: z.boolean(),
    extensionFork: z.boolean().optional(),
  }),
  z.object({ reachable: z.literal(false), reason: z.string() }),
]);
