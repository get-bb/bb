import {
  HIDDEN_THREAD_FOLDER_ERROR_MESSAGE,
  isThreadFolderAssignmentAllowed,
  type ThreadVisibility,
} from "@bb/domain";
import { ApiError } from "../../errors.js";

export function assertThreadFolderAssignmentAllowed(args: {
  folderId: string | null | undefined;
  visibility: ThreadVisibility | undefined;
}): void {
  if (isThreadFolderAssignmentAllowed(args.visibility, args.folderId)) {
    return;
  }
  throw new ApiError(
    400,
    "invalid_request",
    HIDDEN_THREAD_FOLDER_ERROR_MESSAGE,
  );
}
