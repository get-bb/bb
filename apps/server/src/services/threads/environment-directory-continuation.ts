import { and, desc, eq, sql } from "drizzle-orm";
import { events as storedEvents, getThread } from "@bb/db";
import { renderTemplate } from "@bb/templates";
import { z } from "zod";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { queueParentSystemMessage } from "./parent-system-messages.js";
import {
  ENVIRONMENT_DIRECTORY_UPDATE_OPERATION,
  threadWritableFailure,
} from "./thread-environment-directory.js";

const environmentDirectoryUpdateDataSchema = z.object({
  status: z.literal("completed"),
  metadata: z.object({
    nextEnvironmentId: z.string(),
    nextPath: z.string(),
  }),
});

export interface EnvironmentDirectoryContinuation {
  environmentId: string;
  path: string;
}

export function findEnvironmentDirectoryContinuation(
  deps: Pick<AppDeps, "db">,
  args: { threadId: string; turnId: string },
): EnvironmentDirectoryContinuation | null {
  const row = deps.db
    .select({ data: storedEvents.data })
    .from(storedEvents)
    .where(
      and(
        eq(storedEvents.threadId, args.threadId),
        eq(storedEvents.turnId, args.turnId),
        eq(storedEvents.scopeKind, "turn"),
        eq(storedEvents.type, "system/operation"),
        sql`json_extract(${storedEvents.data}, '$.operation') = ${ENVIRONMENT_DIRECTORY_UPDATE_OPERATION}`,
      ),
    )
    .orderBy(desc(storedEvents.sequence))
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  const parsed = environmentDirectoryUpdateDataSchema.safeParse(
    JSON.parse(row.data),
  );
  if (!parsed.success) {
    return null;
  }
  return {
    environmentId: parsed.data.metadata.nextEnvironmentId,
    path: parsed.data.metadata.nextPath,
  };
}

export async function continueAfterEnvironmentDirectoryUpdate(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: EnvironmentDirectoryContinuation & { threadId: string },
): Promise<boolean> {
  const thread = getThread(deps.db, args.threadId);
  if (
    !thread ||
    thread.environmentId !== args.environmentId ||
    threadWritableFailure(thread) !== null
  ) {
    return false;
  }
  if (thread.status === "starting" || thread.status === "active") {
    return true;
  }
  if (thread.status !== "idle") {
    return false;
  }
  return queueParentSystemMessage(deps, {
    parentThreadId: thread.id,
    input: [
      {
        type: "text",
        text: renderTemplate("systemMessageEnvironmentDirectoryUpdated", {
          path: args.path,
        }),
        mentions: [],
      },
    ],
    systemMessageKind: "environment-directory-updated",
    systemMessageSubject: { kind: "directory", path: args.path },
  });
}
