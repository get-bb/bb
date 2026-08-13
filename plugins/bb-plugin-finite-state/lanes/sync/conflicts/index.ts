import { HUMAN_APPROVAL_CAPABILITY_POLICY } from "../../../shared/contract.js";
import type { EngineDeps } from "../engine/pull.js";
import { ConflictResolutionError } from "./resolve.js";

export {
  attributeConflicts,
  conflictAttribution,
  refinePlanCandidate,
  refinePlanConflicts,
  registerAttributionProvider,
  type AttributionProvider,
  type PlanConflictRefinement,
} from "./attribution.js";
export {
  detectConflicts,
  type ConflictAttribution,
  type FieldConflict,
} from "./detect.js";
export {
  mergeSetValues,
  pointerSegments,
  readPointer,
  writePointer,
} from "./merge.js";
export {
  conflictPolicy,
  isPositivelyHuman,
  registerConflictPolicy,
  type ConflictPolicy,
} from "./policy.js";
export {
  ConflictResolutionError,
  materializeExistingWorking,
  resolveConflict,
  type ConflictDeps,
  type ConflictResolution,
  type ResolveConflictInput,
  type WorkingMaterialization,
  type WorkingMaterializationInput,
} from "./resolve.js";

interface FrozenConflictResolveInput {
  humanApprovalCapability: string;
}

/** Frozen v1 has no actor-authenticated capability mint, so RPC must fail closed. */
export function resolveConflictRpc(
  _deps: EngineDeps,
  _input: FrozenConflictResolveInput,
): never {
  throw new ConflictResolutionError(
    "CONFLICT_AUTHORIZATION_UNAVAILABLE",
    `Conflict resolution ${HUMAN_APPROVAL_CAPABILITY_POLICY.handlerDisposition}`,
  );
}
