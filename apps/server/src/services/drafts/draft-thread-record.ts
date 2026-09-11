import {
  createDraftSubmissionReceipt,
  getDraft,
  getDraftSubmissionReceipt,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

export interface DraftSubmissionSource {
  draftId: string;
  revision: number;
}

export function createDraftThreadRecord(
  deps: Pick<AppDeps, "db">,
  source: DraftSubmissionSource,
  create: () => Thread,
): Thread {
  return deps.db.transaction(
    (tx) => {
      if (getDraftSubmissionReceipt(tx, source) !== null) {
        throw new ApiError(
          409,
          "draft_submission_exists",
          "This draft revision already has a submission; retry to read its result",
          true,
        );
      }
      const current = getDraft(tx, source.draftId);
      if (current === null || current.revision !== source.revision) {
        throw new ApiError(
          409,
          "draft_revision_conflict",
          "Draft changed before submission. Its current contents were preserved.",
        );
      }
      const thread = create();
      createDraftSubmissionReceipt(tx, { ...source, threadId: thread.id });
      return thread;
    },
    { behavior: "immediate" },
  );
}
