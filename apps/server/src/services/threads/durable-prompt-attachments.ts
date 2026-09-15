import { getEnvironment } from "@bb/db";
import type { PromptInput, Thread } from "@bb/domain";
import { z } from "zod";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { remapDaemonFileRouteError } from "../hosts/daemon-file-response.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import { preparePromptAttachmentInputGroups } from "../projects/attachments.js";
import {
  readThreadProvisionContext,
  readThreadStartupContextOfKind,
  threadProvisionEnvironmentIntentSchema,
  type ThreadProvisionEnvironmentIntent,
} from "./thread-startup-store.js";

interface PreparePromptInputGroupsForPersistenceArgs {
  hostId: string | null;
  inputGroups: readonly PromptInput[][];
  projectId: string;
}

const promptAttachmentHostContextSchema = z.object({
  environmentIntent: threadProvisionEnvironmentIntentSchema,
});

interface PrepareThreadPromptInputForPersistenceArgs {
  input: PromptInput[];
  thread: Thread;
}

interface PrepareThreadPromptInputGroupsForPersistenceArgs {
  inputGroups: readonly PromptInput[][];
  thread: Thread;
}

function hostIdForProvisioningIntent(
  deps: Pick<LoggedWorkSessionDeps, "db">,
  intent: ThreadProvisionEnvironmentIntent,
): string | null {
  if (intent.type === "provider") {
    return intent.machine.type === "existing" ? intent.machine.hostId : null;
  }
  return getEnvironment(deps.db, intent.environmentId)?.hostId ?? null;
}

function resolveThreadPromptHostId(
  deps: Pick<LoggedWorkSessionDeps, "db">,
  thread: Thread,
): string {
  if (thread.environmentId !== null) {
    const environment = getEnvironment(deps.db, thread.environmentId);
    if (environment) {
      return environment.hostId;
    }
  }

  const pendingContext = readThreadStartupContextOfKind(
    deps.db,
    thread.id,
    "pending",
    promptAttachmentHostContextSchema,
  );
  const environmentIntent =
    pendingContext?.environmentIntent ??
    readThreadProvisionContext(deps.db, thread.id)?.request.environmentIntent ??
    null;
  const hostId =
    environmentIntent === null
      ? null
      : hostIdForProvisioningIntent(deps, environmentIntent);
  if (hostId !== null) {
    return hostId;
  }

  throwThreadEnvironmentUnavailable(
    threadEnvironmentUnavailableDetails("never_attached", null),
  );
}

export async function preparePromptInputGroupsForPersistence(
  deps: LoggedWorkSessionDeps,
  args: PreparePromptInputGroupsForPersistenceArgs,
): Promise<PromptInput[][]> {
  return preparePromptAttachmentInputGroups({
    dataDir: deps.config.dataDir,
    inputGroups: args.inputGroups,
    projectId: args.projectId,
    readHostFile: async (path) => {
      if (args.hostId === null) {
        throwThreadEnvironmentUnavailable(
          threadEnvironmentUnavailableDetails("never_attached", null),
        );
      }
      try {
        return await callHostRetryableOnlineRpc(deps, {
          command: { type: "host.read_file", path },
          hostId: args.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
      } catch (error) {
        return remapDaemonFileRouteError(error);
      }
    },
  });
}

export async function preparePromptInputForPersistence(
  deps: LoggedWorkSessionDeps,
  args: Omit<PreparePromptInputGroupsForPersistenceArgs, "inputGroups"> & {
    input: PromptInput[];
  },
): Promise<PromptInput[]> {
  const [input] = await preparePromptInputGroupsForPersistence(deps, {
    hostId: args.hostId,
    inputGroups: [args.input],
    projectId: args.projectId,
  });
  return input ?? [];
}

export async function prepareThreadPromptInputForPersistence(
  deps: LoggedWorkSessionDeps,
  args: PrepareThreadPromptInputForPersistenceArgs,
): Promise<PromptInput[]> {
  const [input] = await prepareThreadPromptInputGroupsForPersistence(deps, {
    inputGroups: [args.input],
    thread: args.thread,
  });
  return input ?? [];
}

export async function prepareThreadPromptInputGroupsForPersistence(
  deps: LoggedWorkSessionDeps,
  args: PrepareThreadPromptInputGroupsForPersistenceArgs,
): Promise<PromptInput[][]> {
  let hostId: string | null = null;
  return preparePromptAttachmentInputGroups({
    dataDir: deps.config.dataDir,
    inputGroups: args.inputGroups,
    projectId: args.thread.projectId,
    readHostFile: async (path) => {
      hostId ??= resolveThreadPromptHostId(deps, args.thread);
      try {
        return await callHostRetryableOnlineRpc(deps, {
          command: { type: "host.read_file", path },
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
      } catch (error) {
        return remapDaemonFileRouteError(error);
      }
    },
  });
}
