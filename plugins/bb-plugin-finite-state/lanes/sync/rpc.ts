import type { BbPluginApi } from "@bb/plugin-sdk";

import type { AssuranceStudioClient } from "../../lib/remote/types.js";
import { bindWorkspacePlatformProject } from "../../lib/store/project-scope.js";
import { ENTITIES, type EntityKind } from "../../lib/sync/registry.js";
import { rpcContract } from "../../shared/contract.js";
import { resolveConflictRpc } from "./conflicts/index.js";
import { pullIsolated, type EngineDeps } from "./engine/pull.js";
import { status, syncMetadata } from "./engine/status.js";
import { plan } from "./plan/index.js";
import { pushAuthorizationUnavailable } from "./push/index.js";
import {
  assuranceStudioProjectCandidateState,
  enumerateAssuranceStudioProjectCandidates,
  selectedAssuranceStudioProject,
  selectAssuranceStudioProject,
} from "./as-project-binding.js";

const syncContract = {
  syncPull: rpcContract.syncPull,
  syncAsProjectCandidates: rpcContract.syncAsProjectCandidates,
  syncAsProjectSelect: rpcContract.syncAsProjectSelect,
  syncStatus: rpcContract.syncStatus,
  syncPlan: rpcContract.syncPlan,
  syncConflictResolve: rpcContract.syncConflictResolve,
  syncPush: rpcContract.syncPush,
  syncPushRetry: rpcContract.syncPushRetry,
};

function entityKinds(values: string[] | undefined): EntityKind[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => {
    if (!Object.hasOwn(ENTITIES, value))
      throw new Error(`Unknown Finite State entity kind: ${value}`);
    return value as EntityKind;
  });
}

function cacheState(metadata: ReturnType<typeof syncMetadata>) {
  const accepted = new Set(Object.values(metadata.acceptedGenerationIds));
  const revisions = Object.values(metadata.baseRevisions);
  return {
    state: metadata.lastPull === null ? ("empty" as const) : ("fresh" as const),
    asOf: metadata.lastPull,
    message: null,
    acceptedGenerationId:
      accepted.size === 1 ? (accepted.values().next().value ?? null) : null,
    baseRevision: revisions.length === 0 ? 0 : Math.max(...revisions),
  };
}

/** Registers the four WP-17 sync RPC surfaces through one frozen sub-contract. */
export function registerSyncRpc(
  bb: BbPluginApi,
  deps: EngineDeps,
  assuranceStudio: AssuranceStudioClient | null = null,
): void {
  bb.rpc.register(syncContract, {
    async syncAsProjectCandidates(input) {
      if (!assuranceStudio) throw new Error("Assurance Studio is unavailable");
      await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      const items = await enumerateAssuranceStudioProjectCandidates(
        assuranceStudio,
        input.projectId,
      );
      return {
        platformProjectId: input.projectId,
        candidateState: assuranceStudioProjectCandidateState(items),
        selectedAssuranceStudioProjectId: selectedAssuranceStudioProject(
          deps,
          input.workspaceProjectId,
          input.projectId,
        ),
        items,
      };
    },
    async syncAsProjectSelect(input) {
      if (!assuranceStudio) throw new Error("Assurance Studio is unavailable");
      await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      return await selectAssuranceStudioProject(deps, assuranceStudio, {
        workspaceProjectId: input.workspaceProjectId,
        platformProjectId: input.projectId,
        assuranceStudioProjectId: input.assuranceStudioProjectId,
      });
    },
    async syncPull(input) {
      await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      const kinds = entityKinds(input.kinds);
      const scope = {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
      };
      const report = await pullIsolated(deps, scope, kinds, {
        assuranceStudioProjectId: selectedAssuranceStudioProject(
          deps,
          input.workspaceProjectId,
          scope.projectId,
        ),
      });
      bindWorkspacePlatformProject(
        deps.db,
        input.workspaceProjectId,
        scope.projectId,
      );
      const metadata = syncMetadata(deps, scope, kinds);
      return {
        ...scope,
        ...report,
        baseStateSha256: metadata.baseStateSha256,
      };
    },
    async syncStatus(input) {
      if (input.workspaceProjectId) {
        await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      }
      const kinds = entityKinds(input.kinds);
      const scope = {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
      };
      const report = await status(deps, scope, kinds, {
        assuranceStudioProjectId: input.workspaceProjectId
          ? selectedAssuranceStudioProject(
              deps,
              input.workspaceProjectId,
              scope.projectId,
            )
          : null,
      });
      const metadata = syncMetadata(deps, scope, kinds);
      const scopedChange = (
        change: { kind: EntityKind; key: string; fields: string[] },
        artifactId: string | null,
      ) => ({
        ...scope,
        kind: change.kind,
        key: change.key,
        fields: change.fields,
        artifactId,
      });
      return {
        ...scope,
        acceptedGenerationIds: metadata.acceptedGenerationIds,
        stagingGenerationIds: metadata.stagingGenerationIds,
        baseRevisions: metadata.baseRevisions,
        baseStateSha256: metadata.baseStateSha256,
        local: report.local.map((change) => scopedChange(change, null)),
        upstream: report.upstream.map((change) => scopedChange(change, null)),
        conflicts: report.conflicts.map((change) =>
          scopedChange({ ...change, fields: [] }, null),
        ),
        orphans: report.orphans.map((change) =>
          scopedChange({ ...change, fields: [] }, change.file),
        ),
        cache: cacheState(metadata),
      };
    },
    async syncPlan(input) {
      if (input.workspaceProjectId) {
        await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      }
      return plan(deps, {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        kinds: entityKinds(input.kinds),
        pageSize: input.pageSize,
        continuation: input.continuation,
        binding: {
          assuranceStudioProjectId: input.workspaceProjectId
            ? selectedAssuranceStudioProject(
                deps,
                input.workspaceProjectId,
                input.projectId,
              )
            : null,
        },
      });
    },
    syncConflictResolve: (input) => resolveConflictRpc(deps, input),
    syncPush: (input) =>
      pushAuthorizationUnavailable(deps, input.humanApprovalCapability),
    syncPushRetry: (input) =>
      pushAuthorizationUnavailable(deps, input.humanApprovalCapability),
  });
}
