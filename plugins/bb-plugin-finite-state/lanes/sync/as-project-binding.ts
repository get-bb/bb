import type {
  AssuranceStudioClient,
  AssuranceStudioProjectLinkCandidate,
} from "../../lib/remote/types.js";
import { RemoteError } from "../../lib/remote/types.js";
import {
  assuranceStudioProjectBinding,
  bindWorkspacePlatformProject,
  selectAssuranceStudioProjectBinding,
} from "../../lib/store/project-scope.js";
import type { EngineDeps } from "./engine/pull.js";

const ENUMERATION_PAGE_SIZE = 200;
const MAX_PROJECT_LINK_CANDIDATES = 1_000;

export type AssuranceStudioProjectCandidateState =
  | "ambiguous"
  | "none"
  | "unambiguous";

/** Reports multiplicity without selecting, ranking, or collapsing candidates. */
export function assuranceStudioProjectCandidateState(
  candidates: readonly AssuranceStudioProjectLinkCandidate[],
): AssuranceStudioProjectCandidateState {
  if (candidates.length === 0) return "none";
  return candidates.length === 1 ? "unambiguous" : "ambiguous";
}

export async function enumerateAssuranceStudioProjectCandidates(
  assuranceStudio: AssuranceStudioClient,
  platformProjectId: string,
): Promise<AssuranceStudioProjectLinkCandidate[]> {
  const candidates: AssuranceStudioProjectLinkCandidate[] = [];
  for await (const page of assuranceStudio.listProjectLinks({
    platformProjectId,
    page: { pageSize: ENUMERATION_PAGE_SIZE },
  })) {
    candidates.push(...page.items);
    if (candidates.length > MAX_PROJECT_LINK_CANDIDATES) {
      throw new RemoteError(
        "Assurance Studio project-link candidates exceeded their bound",
        {
          service: "assurance-studio",
          code: "AS_PROJECT_CANDIDATE_LIMIT",
          status: null,
          retryable: false,
          retryAfterMs: null,
          details: { maxCandidates: MAX_PROJECT_LINK_CANDIDATES },
        },
      );
    }
  }
  return candidates;
}

export function selectedAssuranceStudioProject(
  deps: EngineDeps,
  workspaceProjectId: string,
  platformProjectId: string,
): string | null {
  return assuranceStudioProjectBinding(
    deps.db,
    workspaceProjectId,
    platformProjectId,
  );
}

export async function selectAssuranceStudioProject(
  deps: EngineDeps,
  assuranceStudio: AssuranceStudioClient,
  input: {
    workspaceProjectId: string;
    platformProjectId: string;
    assuranceStudioProjectId: string;
  },
): Promise<AssuranceStudioProjectLinkCandidate> {
  const candidates = await enumerateAssuranceStudioProjectCandidates(
    assuranceStudio,
    input.platformProjectId,
  );
  const selected = candidates.find(
    (candidate) =>
      candidate.assuranceStudioProjectId === input.assuranceStudioProjectId,
  );
  if (!selected) {
    throw new Error("AS_PROJECT_SELECTION_NOT_LINKED");
  }
  deps.db.transaction(() => {
    bindWorkspacePlatformProject(
      deps.db,
      input.workspaceProjectId,
      input.platformProjectId,
    );
    selectAssuranceStudioProjectBinding(
      deps.db,
      input.workspaceProjectId,
      input.platformProjectId,
      input.assuranceStudioProjectId,
    );
  })();
  return selected;
}
