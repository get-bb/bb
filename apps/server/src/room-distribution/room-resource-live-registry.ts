import { listBuiltInAgentProviderInfos } from "@bb/agent-providers";
import {
  getLatestSessionForHost,
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
  WorkTogetherRoomRepositoryRevisionUnavailableError,
  type WorkTogetherRoomHostTarget,
  type WorkTogetherRoomRepositoryTarget,
  type WorkTogetherRoomResourceRegistry,
  type WorkTogetherRoomResourceTarget,
} from "./room-resource-provisioner.js";

const PROVIDER_REPOSITORY_ID = /^[1-9][0-9]{0,127}$/u;

export interface ResolveWorkTogetherGithubRepositoryArgs {
  hostId: string;
  knownPaths: readonly string[];
  providerRepositoryId: string;
  objectFormat?: "sha1" | "sha256";
  baseRevision?: string;
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
  repository: Extract<
    ResolveGithubRepositoryResult,
    { outcome: "found" }
  >["repository"],
  sources: ReturnType<typeof listPublicLocalPathProjectSourcesForHost>,
): WorkTogetherRoomRepositoryTarget {
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
        ...(args.objectFormat !== undefined && args.baseRevision !== undefined
          ? { objectFormat: args.objectFormat, baseRevision: args.baseRevision }
          : {}),
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
  const resolveHost = (input: {
    candidateHostId: string;
  }): WorkTogetherRoomHostTarget => {
    if (typeof input?.candidateHostId !== "string") {
      throw new WorkTogetherRoomProvisioningUnavailableError();
    }
    const hosts = listPublicHosts(deps.db);
    if (hosts.length !== 1 || hosts[0] === undefined) {
      throw new WorkTogetherRoomProvisioningUnavailableError();
    }
    const host = hosts[0];
    const session = getLatestSessionForHost(deps.db, { hostId: host.id });
    if (session === null || session.status !== "active") {
      throw new WorkTogetherRoomProvisioningUnavailableError();
    }
    return Object.freeze({
      bbHostId: host.id,
      dataDir: session.dataDir,
      providerId: defaultProviderId(),
    });
  };

  return Object.freeze({
    resolveHost,
    async resolve(input: {
      candidateHostId: string;
      providerRepositoryId: string;
      environmentTemplate?: "managed-worktree" | "detached-read-only";
      objectFormat?: "sha1" | "sha256";
      baseRevision?: string;
    }): Promise<WorkTogetherRoomResourceTarget | null> {
      if (
        typeof input?.providerRepositoryId !== "string" ||
        !PROVIDER_REPOSITORY_ID.test(input.providerRepositoryId)
      ) {
        throw new WorkTogetherRoomProvisioningUnavailableError();
      }

      const hostTarget = resolveHost({
        candidateHostId: input.candidateHostId,
      });
      const host = listPublicHosts(deps.db).find(
        (candidate) => candidate.id === hostTarget.bbHostId,
      );
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
          ...(input.environmentTemplate === "detached-read-only" &&
          input.objectFormat !== undefined &&
          input.baseRevision !== undefined
            ? {
                objectFormat: input.objectFormat,
                baseRevision: input.baseRevision,
              }
            : {}),
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
      if (result.outcome === "revision_unavailable") {
        throw new WorkTogetherRoomRepositoryRevisionUnavailableError();
      }
      return Object.freeze({
        ...hostTarget,
        ...targetFromResolvedCheckout(result.repository, sources),
      });
    },
  });
}
