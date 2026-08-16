import { listBuiltInAgentProviderInfos } from "@bb/agent-providers";
import {
  listPublicHosts,
  listPublicLocalPathProjectSourcesForHost,
} from "@bb/db";
import type { ResolveGithubRepositoryResult } from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import type { WorkSessionDeps } from "../types.js";
import {
  WorkTogetherRoomProvisioningUnavailableError,
  type WorkTogetherRoomResourceRegistry,
  type WorkTogetherRoomResourceTarget,
} from "./room-resource-provisioner.js";

const PROVIDER_REPOSITORY_ID = /^[1-9][0-9]{0,127}$/u;

export interface ResolveWorkTogetherGithubRepositoryArgs {
  hostId: string;
  knownPaths: readonly string[];
  providerRepositoryId: string;
}

export type ResolveWorkTogetherGithubRepository = (
  args: ResolveWorkTogetherGithubRepositoryArgs,
) => Promise<ResolveGithubRepositoryResult>;

export interface LiveWorkTogetherRoomResourceRegistryDeps {
  db: WorkSessionDeps["db"];
  resolveGithubRepository: ResolveWorkTogetherGithubRepository;
}

function defaultProviderId(): string {
  const providerId = listBuiltInAgentProviderInfos()[0]?.id;
  if (providerId === undefined) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  return providerId;
}

function targetFromResolvedCheckout(
  hostId: string,
  repository: Extract<
    ResolveGithubRepositoryResult,
    { outcome: "found" }
  >["repository"],
  sources: ReturnType<typeof listPublicLocalPathProjectSourcesForHost>,
): WorkTogetherRoomResourceTarget {
  const matching = sources
    .filter((source) => source.path === repository.path)
    .sort((left, right) =>
      left.projectId < right.projectId
        ? -1
        : left.projectId > right.projectId
          ? 1
          : 0,
    );
  const project = matching[0];
  return Object.freeze({
    bbHostId: hostId,
    providerId: project?.providerId ?? defaultProviderId(),
    projectName: project?.projectName ?? repository.name,
    sourcePath: repository.path,
  });
}

export function createHostWorkTogetherGithubRepositoryResolver(
  deps: WorkSessionDeps,
): ResolveWorkTogetherGithubRepository {
  return async (args) =>
    callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.resolve_github_repository",
        providerRepositoryId: args.providerRepositoryId,
        knownPaths: [...args.knownPaths],
      },
    });
}

/**
 * Resolve a Work Together binding to a host checkout the cell already has.
 * A WT cell is single-host; `candidateHostId` is not a lookup key.
 */
export function createLiveWorkTogetherRoomResourceRegistry(
  deps: LiveWorkTogetherRoomResourceRegistryDeps,
): WorkTogetherRoomResourceRegistry {
  return Object.freeze({
    async resolve(input: {
      candidateHostId: string;
      providerRepositoryId: string;
    }): Promise<WorkTogetherRoomResourceTarget | null> {
      if (
        typeof input?.providerRepositoryId !== "string" ||
        !PROVIDER_REPOSITORY_ID.test(input.providerRepositoryId)
      ) {
        throw new WorkTogetherRoomProvisioningUnavailableError();
      }

      const hosts = listPublicHosts(deps.db);
      if (hosts.length !== 1) {
        throw new WorkTogetherRoomProvisioningUnavailableError();
      }
      const host = hosts[0];
      if (host === undefined) {
        throw new WorkTogetherRoomProvisioningUnavailableError();
      }

      const sources = listPublicLocalPathProjectSourcesForHost(
        deps.db,
        host.id,
      );
      const knownPaths = [
        ...new Set(sources.map((source) => source.path)),
      ].sort();

      let result: ResolveGithubRepositoryResult;
      try {
        result = await deps.resolveGithubRepository({
          hostId: host.id,
          knownPaths,
          providerRepositoryId: input.providerRepositoryId,
        });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new WorkTogetherRoomProvisioningUnavailableError();
      }

      if (result.outcome === "unavailable") {
        throw new WorkTogetherRoomProvisioningUnavailableError();
      }
      if (result.outcome === "not_found") {
        return null;
      }
      return targetFromResolvedCheckout(host.id, result.repository, sources);
    },
  });
}
