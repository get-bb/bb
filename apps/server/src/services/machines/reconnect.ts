import { getHost, getLatestSessionForHost } from "@bb/db";
import type { HostReconnectResponse } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  findUnusedEnrollmentCredential,
  type EnrollmentBootstrap,
} from "./enrollments.js";
import { manualEnrollmentCommand } from "./manual-enrollment-command.js";
import { serverAccess } from "./server-access.js";

type Dependencies = Pick<AppDeps, "db" | "hub" | "logger" | "machineAuth">;

const SERVER_ACCESS_TIMEOUT_MS = 60_000;

export async function prepareReconnect(
  deps: Dependencies,
  hostId: string,
): Promise<HostReconnectResponse> {
  let serverUrl: string;
  try {
    ({ serverUrl } = await serverAccess.resolve(deps, {
      key: hostId,
      hostId,
      signal: AbortSignal.timeout(SERVER_ACCESS_TIMEOUT_MS),
    }));
  } catch (error) {
    throw new ApiError(
      409,
      "machine_reconnect_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  const credential = await deps.machineAuth.issueHostEnrollKey({
    hostId,
    enrollSource: "reconnect",
  });
  return {
    command: manualEnrollmentCommand({
      hostId,
      serverUrl,
      credential: credential.key,
      expiresAt: credential.expiresAt,
    }),
    expiresAt: credential.expiresAt,
    hostId,
  };
}

export async function reconnectBootstrapForCredential(
  deps: Dependencies,
  credential: string,
): Promise<EnrollmentBootstrap | null> {
  const enrollment = await findUnusedEnrollmentCredential(deps.db, credential);
  if (enrollment?.enrollSource !== "reconnect") return null;
  const host = getHost(deps.db, enrollment.hostId);
  if (!host || host.destroyedAt !== null || host.phase !== "active")
    return null;
  const grant = await serverAccess.repair(deps, {
    key: host.id,
    hostId: host.id,
    signal: AbortSignal.timeout(SERVER_ACCESS_TIMEOUT_MS),
  });
  const session = getLatestSessionForHost(deps.db, { hostId: host.id });
  return {
    hostId: host.id,
    serverUrl: grant.serverUrl,
    ...(grant.headers === undefined ? {} : { headers: grant.headers }),
    credential,
    expiresAt: enrollment.expiresAt,
    reconnect: true,
    ...(session === null ? {} : { dataDir: session.dataDir }),
  };
}
