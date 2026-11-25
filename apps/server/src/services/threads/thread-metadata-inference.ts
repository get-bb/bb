import { getEnvironment, getThread } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  applyGeneratedThreadTitle,
  generateThreadMetadataWithOutcome,
} from "./title-generation.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { perDbRegistry } from "../lib/per-db-registry.js";

const pendingTitles = new WeakMap<object, Map<string, Promise<void>>>();

async function inferThreadTitle(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { input: PromptInput[]; threadId: string },
): Promise<void> {
  const outcome = await generateThreadMetadataWithOutcome(deps, args);
  const title = outcome.metadata?.title;
  if (!title || !applyGeneratedThreadTitle(deps, { ...args, title })) return;
  const thread = getThread(deps.db, args.threadId);
  const environment = thread?.environmentId
    ? getEnvironment(deps.db, thread.environmentId)
    : null;
  if (
    !thread ||
    !environment ||
    (thread.status !== "active" && thread.status !== "idle")
  )
    return;
  dispatchThreadRenameCommand(deps, {
    environment: { id: environment.id, hostId: environment.hostId },
    providerId: thread.providerId,
    threadId: thread.id,
    title,
  });
}

export function startThreadTitleGeneration(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { input: PromptInput[]; threadId: string },
): void {
  const pending = perDbRegistry(pendingTitles, deps.db);
  if (pending.has(args.threadId)) return;
  const settled = inferThreadTitle(deps, args)
    .catch((error) =>
      deps.logger.warn(
        {
          threadId: args.threadId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Failed to generate thread title",
      ),
    )
    .finally(() => pending.delete(args.threadId));
  pending.set(args.threadId, settled);
}

export async function threadTitleSettled(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db">,
  threadId: string,
): Promise<void> {
  await perDbRegistry(pendingTitles, deps.db).get(threadId);
}
