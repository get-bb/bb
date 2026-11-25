import { createEventId } from "@bb/db";
import { WORKSPACE_FOLDERS_MISSING_OPERATION, threadScope } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { appendThreadEvent } from "./thread-events.js";

const reportedMissingFolders = new WeakMap<object, Map<string, string>>();

interface ReportMissingWorkspaceFoldersArgs {
  environmentId: string;
  missingPaths: readonly string[];
  threadId: string;
}

export function reportMissingWorkspaceFolders(
  deps: Pick<AppDeps, "db" | "hub">,
  args: ReportMissingWorkspaceFoldersArgs,
): void {
  let reportedByThread = reportedMissingFolders.get(deps.db);
  if (reportedByThread === undefined) {
    reportedByThread = new Map();
    reportedMissingFolders.set(deps.db, reportedByThread);
  }
  if (args.missingPaths.length === 0) {
    reportedByThread.delete(args.threadId);
    return;
  }
  const key = JSON.stringify(args.missingPaths);
  if (reportedByThread.get(args.threadId) === key) {
    return;
  }
  reportedByThread.set(args.threadId, key);
  const pronoun = args.missingPaths.length === 1 ? "it exists" : "they exist";
  appendThreadEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    type: "system/operation",
    scope: threadScope(),
    data: {
      operation: WORKSPACE_FOLDERS_MISSING_OPERATION,
      operationId: createEventId(),
      status: "failed",
      message: `${args.missingPaths.join(", ")}. The agent can't use this until ${pronoun}.`,
      metadata: { missingPaths: [...args.missingPaths] },
    },
  });
}
