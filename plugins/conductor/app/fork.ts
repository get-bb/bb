import { toast } from "sonner";
import type { PluginMessageActionContext } from "@get-bb/plugin-sdk/app";

const WORKTREE_PROVIDER_ID = "git-worktree";

export async function forkToNewWorkspace(
  context: Pick<
    PluginMessageActionContext,
    "threadId" | "message" | "sdk" | "navigate"
  >,
): Promise<void> {
  const { sdk, navigate } = context;
  const source = await sdk.threads.get({ threadId: context.threadId });
  const environmentId = source.environmentId;
  const environment =
    environmentId === null
      ? null
      : await sdk.environments.get({ environmentId });
  try {
    const fork = await sdk.threads.fork({
      sourceThreadId: source.id,
      sourceSeqEnd: context.message.sourceSeqEnd,
      ...(source.title === null ? {} : { title: source.title }),
      environment: {
        type: "provider",
        environmentProviderId: WORKTREE_PROVIDER_ID,
        ...(environment === null
          ? {}
          : {
              machine: { type: "existing", hostId: environment.hostId },
            }),
        inputs: {},
      },
    });
    navigate.toThread(fork.id);
  } catch (error) {
    toast.error(
      error instanceof Error
        ? `Could not fork to a new workspace: ${error.message}`
        : "Could not fork to a new workspace.",
    );
  }
}
