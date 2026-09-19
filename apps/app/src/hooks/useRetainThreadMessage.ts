import { useQueryClient } from "@tanstack/react-query";
import { useSystemConfig } from "./queries/system-queries";
import { useServerConnectionState } from "./useServerConnectionState";
import { retainThreadMessage } from "@/lib/pending-thread-messages";
import { notifyComposerSubmitted } from "@/lib/composer-submissions";

export function useRetainThreadMessage() {
  const queryClient = useQueryClient();
  const { data: config } = useSystemConfig();
  const connection = useServerConnectionState();
  return {
    connected: !config?.messageSubmissionKeys || connection === "connected",
    retain(
      args: Omit<Parameters<typeof retainThreadMessage>[0], "queryClient">,
    ): boolean {
      if (
        !config?.messageSubmissionKeys ||
        args.request.input.some(
          (block) =>
            block.type === "text" &&
            block.mentions.some(
              (mention) =>
                mention.resource.kind === "command" &&
                mention.resource.source === "command",
            ),
        )
      )
        return false;
      retainThreadMessage({ ...args, queryClient });
      notifyComposerSubmitted({ kind: "thread", threadId: args.request.id });
      return true;
    },
  };
}
