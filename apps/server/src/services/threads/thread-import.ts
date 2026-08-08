import {
  findLiveThreadIdByProviderThreadId,
  findProjectEnvironmentByHostPath,
  findProviderSessionReservationThreadId,
} from "@bb/db";
import { normalizeProjectPathInput } from "@bb/domain";
import {
  isAcpProviderId,
  supportsProviderSessionImport,
} from "@bb/agent-providers";
import type { ImportThreadRequest } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { buildAcpLaunchSpecForProviderId } from "../system/known-acp-agents.js";
import { createThreadFromRequest } from "./thread-create.js";
import {
  requirePublicProjectForThreadCreate,
  requireSourceForHost,
} from "./thread-create-helpers.js";

type ThreadImportDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * The static ACP-family constant only says the protocol has a session/load
 * primitive; whether this specific agent binary actually implements it is
 * only knowable from its live `initialize` handshake
 * (agentCapabilities.loadSession). Ask the daemon for that live capability
 * (the same probe model discovery already performs, including for agents
 * whose model list comes from a CLI command rather than ACP-native session
 * discovery), resolving the launch spec the exact same way thread.start does
 * (buildAcpLaunchSpecForProviderId: a configured custom ACP agent shadows a
 * built-in known agent with the same provider id) so the probed binary is
 * the one that will actually serve the thread. An agent that doesn't
 * support it is refused here instead of silently provisioning an
 * environment and dispatching a doomed thread.start. Best-effort: any probe
 * failure or a provider id with no resolvable launch spec falls back to the
 * static family check, with the bridge's own refusal
 * (packages/agent-runtime/src/acp/bridge/bridge.ts) as the final backstop.
 */
async function probeAcpSupportsSessionImport(
  deps: ThreadImportDeps,
  args: { hostId: string; providerId: string },
): Promise<boolean | undefined> {
  const acpLaunchSpec = buildAcpLaunchSpecForProviderId(
    deps.config.customAcpAgents,
    args.providerId,
  );
  if (!acpLaunchSpec) {
    return undefined;
  }
  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider.list_models",
        providerId: args.providerId,
        acpLaunchSpec,
      },
    });
    return result.supportsSessionImport;
  } catch {
    return undefined;
  }
}

async function requireImportCapableProvider(
  deps: ThreadImportDeps,
  args: { hostId: string; providerId: string },
): Promise<void> {
  if (!supportsProviderSessionImport(args.providerId)) {
    throw new ApiError(
      400,
      "invalid_request",
      `Provider ${args.providerId} does not support session import`,
    );
  }
  if (!isAcpProviderId(args.providerId)) {
    return;
  }
  const liveSupportsSessionImport = await probeAcpSupportsSessionImport(
    deps,
    args,
  );
  if (liveSupportsSessionImport === false) {
    throw new ApiError(
      400,
      "invalid_request",
      `Provider ${args.providerId}'s agent does not support session/load, so it cannot import an existing session`,
    );
  }
}

/**
 * Non-Codex ACP threads share one bridge process per provider, which routes
 * turns by provider session id (packages/agent-runtime/src/acp/bridge/bridge.ts).
 * Binding a second bb thread to a provider session another live thread
 * already binds would make the bridge misroute turns between the two, so
 * refuse it up front. Two sources cover the two ways a session gets bound:
 * the reservation table holds sessions other imports claimed (including ones
 * whose start has not completed yet), and the event-log reverse lookup holds
 * sessions a plain thread start/resume already recorded. This pre-flight
 * check is best-effort; the race-safe guard is the reservation claimed
 * inside the thread-create transaction (packages/db createThread).
 */
function requireUnboundProviderSession(
  deps: Pick<ThreadImportDeps, "db">,
  args: { hostId: string; providerId: string; providerSessionId: string },
): void {
  const existingThreadId =
    findProviderSessionReservationThreadId(deps.db, args) ??
    findLiveThreadIdByProviderThreadId(deps.db, {
      hostId: args.hostId,
      providerId: args.providerId,
      providerThreadId: args.providerSessionId,
    });
  if (existingThreadId !== null) {
    throw new ApiError(
      409,
      "provider_session_already_bound",
      `Provider session ${args.providerSessionId} is already bound to thread ${existingThreadId}`,
    );
  }
}

/**
 * Validate the caller-asserted working directory the imported session ran
 * in. bb cannot read this back from the external session itself (ACP has no
 * such query), so `requestedCwd` is an assertion, not a verified fact: it
 * must match the project source path or an existing workspace already
 * attached to this project; anything else is refused so the imported
 * conversation cannot be bound to an unrelated project. A mismatch the
 * caller doesn't catch here may still surface later as an agent-side
 * session/load failure (packages/agent-runtime/src/acp/bridge/bridge.ts).
 */
function resolveImportCwd(
  deps: Pick<ThreadImportDeps, "db">,
  args: {
    hostId: string;
    projectId: string;
    requestedCwd: string;
    sourcePath: string;
  },
): string {
  const cwd = normalizeProjectPathInput(args.requestedCwd);
  if (cwd === normalizeProjectPathInput(args.sourcePath)) {
    return cwd;
  }
  const environment = findProjectEnvironmentByHostPath(
    deps.db,
    args.projectId,
    args.hostId,
    cwd,
  );
  if (environment) {
    return cwd;
  }
  throw new ApiError(
    400,
    "invalid_request",
    `Imported session cwd ${cwd} does not match the project source ` +
      `${args.sourcePath} or an existing workspace of this project`,
  );
}

export async function createThreadImportFromRequest(
  deps: ThreadImportDeps,
  request: ImportThreadRequest,
) {
  requirePublicProjectForThreadCreate(deps, request.projectId);
  const hostId = request.hostId ?? requireConnectedPrimaryHostId(deps);
  await requireImportCapableProvider(deps, {
    hostId,
    providerId: request.providerId,
  });
  requireUnboundProviderSession(deps, {
    hostId,
    providerId: request.providerId,
    providerSessionId: request.providerSessionId,
  });
  const source = requireSourceForHost(deps, request.projectId, hostId);
  const cwd = resolveImportCwd(deps, {
    hostId,
    projectId: request.projectId,
    requestedCwd: request.cwd,
    sourcePath: source.path,
  });

  return createThreadFromRequest(deps, {
    environment: {
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path: cwd },
    },
    // The imported session's first "turn" is pure history replay; no live run
    // is dispatched, so the start carries no input.
    input: [],
    origin: request.origin,
    ...(request.originPluginId === undefined
      ? {}
      : { originPluginId: request.originPluginId }),
    ...(request.permissionMode === undefined
      ? {}
      : { permissionMode: request.permissionMode }),
    projectId: request.projectId,
    providerId: request.providerId,
    sessionImport: { providerThreadId: request.providerSessionId },
    startedOnBehalfOf: null,
    ...(request.title === undefined ? {} : { title: request.title }),
    visibility: request.visibility,
  });
}
