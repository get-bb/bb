import { getEnvironment } from "@bb/db";
import type { PromptInput, Thread } from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { remapDaemonFileRouteError } from "../hosts/daemon-file-response.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import { preparePromptAttachmentInputGroups } from "../projects/attachments.js";
import { getActiveThreadProvisionContext } from "./thread-provisioning-active-context.js";
import type { ThreadProvisionEnvironmentIntent } from "./thread-provisioning-context.js";

interface PreparePromptInputGroupsForPersistenceArgs {
  hostId: string;
  inputGroups: readonly PromptInput[][];
  projectId: string;
}

interface PrepareThreadPromptInputForPersistenceArgs {
  input: PromptInput[];
  thread: Thread;
}

function hostIdForProvisioningIntent(
  deps: Pick<LoggedWorkSessionDeps, "db">,
  intent: ThreadProvisionEnvironmentIntent,
): string | null {
  if (intent.type !== "reuse") {
    return intent.hostId;
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

  const context = getActiveThreadProvisionContext(thread.id);
  const hostId = context
    ? hostIdForProvisioningIntent(deps, context.request.environmentIntent)
    : null;
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
  let hostId: string | null = null;
  const [input] = await preparePromptAttachmentInputGroups({
    dataDir: deps.config.dataDir,
    inputGroups: [args.input],
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
  return input ?? [];
}
