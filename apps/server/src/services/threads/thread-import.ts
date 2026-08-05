import { findEnvironmentByHostPath } from "@bb/db";
import { normalizeProjectPathInput } from "@bb/domain";
import { supportsProviderSessionImport } from "@bb/agent-providers";
import type { ImportThreadRequest } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { createThreadFromRequest } from "./thread-create.js";
import {
  requirePublicProjectForThreadCreate,
  requireSourceForHost,
} from "./thread-create-helpers.js";

type ThreadImportDeps = LoggedPendingInteractionWorkSessionDeps;

function requireImportCapableProvider(providerId: string): void {
  if (!supportsProviderSessionImport(providerId)) {
    throw new ApiError(
      400,
      "invalid_request",
      `Provider ${providerId} does not support session import`,
    );
  }
}

/**
 * Resolve the workspace path the imported session ran in. The external
 * session's cwd must match the project source path (the default) or an
 * existing workspace already attached to this project; anything else is
 * refused so the imported conversation cannot be bound to an unrelated
 * project.
 */
function resolveImportCwd(
  deps: Pick<ThreadImportDeps, "db">,
  args: {
    hostId: string;
    projectId: string;
    requestedCwd: string | undefined;
    sourcePath: string;
  },
): string {
  if (args.requestedCwd === undefined) {
    return args.sourcePath;
  }
  const cwd = normalizeProjectPathInput(args.requestedCwd);
  if (cwd === normalizeProjectPathInput(args.sourcePath)) {
    return cwd;
  }
  const environment = findEnvironmentByHostPath(deps.db, args.hostId, cwd);
  if (environment && environment.projectId === args.projectId) {
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
  requireImportCapableProvider(request.providerId);
  requirePublicProjectForThreadCreate(deps, request.projectId);
  const hostId = request.hostId ?? requireConnectedPrimaryHostId(deps);
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
