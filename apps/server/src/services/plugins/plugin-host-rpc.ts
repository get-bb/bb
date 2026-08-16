import { randomUUID } from "node:crypto";
import { listPublicHosts } from "@bb/db";
import type {
  ExperimentalHostRpcContract,
  StandardSchemaV1,
  StandardSchemaV1Result,
} from "@get-bb/plugin-sdk";
import type { JsonValue } from "@bb/domain";
import {
  workspaceResolutionFailureCodeSchema,
  type WorkspaceResolutionFailureCode,
} from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { requireReadyEnvironment } from "../lib/entity-lookup.js";
import type { PluginHostArtifactSnapshot } from "./plugin-service-internal.js";

const HOST_RPC_TRANSPORT_GRACE_MS = 6_000;
const HOST_RPC_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;

async function validateValue(
  schema: StandardSchemaV1,
  value: unknown,
  phase: "input" | "output",
): Promise<unknown> {
  let result: StandardSchemaV1Result<unknown>;
  try {
    result = await schema["~standard"].validate(value);
  } catch (error) {
    throw new Error(
      `host rpc ${phase} validator failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.issues !== undefined) {
    throw new Error(
      `host rpc ${phase} validation failed: ${result.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.value;
}

function normalizeJson(value: unknown, label: string): JsonValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    throw new Error(`${label} is not JSON-serializable`);
  }
  if (Buffer.byteLength(serialized) > HOST_RPC_PAYLOAD_MAX_BYTES) {
    throw new Error(`${label} exceeds ${HOST_RPC_PAYLOAD_MAX_BYTES} bytes`);
  }
  return JSON.parse(serialized) as JsonValue;
}

function abortError(): Error {
  return Object.assign(new Error("Host plugin call was cancelled"), {
    name: "AbortError",
  });
}

function rethrowHostRpcError(error: unknown, workspacePath?: string): never {
  if (workspacePath !== undefined && error instanceof ApiError) {
    const code = workspaceResolutionFailureCodeSchema.safeParse(
      error.body.code,
    );
    if (code.success) {
      const failure: {
        code: WorkspaceResolutionFailureCode;
        message: string;
        workspacePath: string;
      } = {
        code: code.data,
        message: error.body.message,
        workspacePath,
      };
      throw new ApiError(409, "workspace_unavailable", failure.message, {
        details: { kind: "workspace_unavailable", failure },
        retryable: false,
      });
    }
  }
  throw error;
}

export async function callPluginHostRpc(
  deps: WorkSessionDeps,
  args: {
    pluginId: string;
    contract: ExperimentalHostRpcContract;
    method: string;
    input: unknown;
    target: { hostId: string } | { environmentId: string };
    signal?: AbortSignal;
    artifact: PluginHostArtifactSnapshot;
  },
): Promise<unknown> {
  const method = args.contract.methods[args.method];
  if (method === undefined) {
    throw new Error(`unknown host rpc method "${args.method}"`);
  }
  if (args.signal?.aborted) throw abortError();
  const input = normalizeJson(
    await validateValue(method.input, args.input, "input"),
    `host rpc input for ${args.method}`,
  );
  let hostId: string;
  let target:
    | { kind: "host" }
    | {
        kind: "environment";
        environmentId: string;
        workspaceContext: ReturnType<
          typeof requireWorkspaceCommandTarget
        >["workspaceContext"];
      };
  let scheduling: "shared" | "exclusive" | null;
  if (method.target.kind === "host") {
    if (!("hostId" in args.target)) {
      throw new Error(
        `host rpc method "${args.method}" requires a host target`,
      );
    }
    hostId = args.target.hostId;
    target = { kind: "host" };
    scheduling = null;
  } else {
    if (!("environmentId" in args.target)) {
      throw new Error(
        `host rpc method "${args.method}" requires an environment target`,
      );
    }
    const resolved = requireWorkspaceCommandTarget(
      requireReadyEnvironment(deps.db, args.target.environmentId),
    );
    hostId = resolved.hostId;
    target = {
      kind: "environment",
      environmentId: resolved.environmentId,
      workspaceContext: resolved.workspaceContext,
    };
    scheduling = method.target.scheduling;
  }
  const callId = randomUUID();
  const rpc = callHostOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS + HOST_RPC_TRANSPORT_GRACE_MS,
    command: {
      type: "plugin.host.call",
      pluginId: args.pluginId,
      generation: args.artifact.generation,
      artifact: {
        digest: args.artifact.digest,
        byteLength: args.artifact.byteLength,
      },
      callId,
      method: args.method,
      input,
      target,
      scheduling,
      deadlineUnixMs: Date.now() + COMMAND_TIMEOUT_MS,
    },
  });
  const signal = args.signal;
  let result: Awaited<typeof rpc>;
  try {
    result =
      signal === undefined
        ? await rpc
        : await new Promise<Awaited<typeof rpc>>((resolve, reject) => {
            let settled = false;
            const finish = (fn: () => void): void => {
              if (settled) return;
              settled = true;
              signal.removeEventListener("abort", onAbort);
              fn();
            };
            const onAbort = (): void => {
              void callHostOnlineRpc(deps, {
                hostId,
                timeoutMs: HOST_RPC_TRANSPORT_GRACE_MS,
                command: {
                  type: "plugin.host.cancel",
                  pluginId: args.pluginId,
                  generation: args.artifact.generation,
                  callId,
                },
              }).catch(() => undefined);
              finish(() => reject(abortError()));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
            rpc.then(
              (value) => finish(() => resolve(value)),
              (error) => finish(() => reject(error)),
            );
          });
  } catch (error) {
    rethrowHostRpcError(
      error,
      target.kind === "environment"
        ? target.workspaceContext.workspacePath
        : undefined,
    );
  }
  const output = await validateValue(method.output, result.output, "output");
  // The daemon already returned JSON. This second validation is the server
  // side of the contract and may intentionally transform that wire value into
  // the schema's typed output (for example, a Date). Return it as-is.
  return output;
}

export async function disposePluginHostWorkers(
  deps: WorkSessionDeps,
  args: { pluginId: string; generation: string },
): Promise<void> {
  const calls = listPublicHosts(deps.db)
    .filter((host) => deps.hub.hasDaemonForHost(host.id))
    .map((host) =>
      callHostOnlineRpc(deps, {
        hostId: host.id,
        timeoutMs: HOST_RPC_TRANSPORT_GRACE_MS,
        command: {
          type: "plugin.host.dispose",
          pluginId: args.pluginId,
          generation: args.generation,
        },
      }),
    );
  await Promise.allSettled(calls);
}
