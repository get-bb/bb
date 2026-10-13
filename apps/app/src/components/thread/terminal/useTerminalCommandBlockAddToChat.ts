import { useCallback } from "react";
import {
  formatTerminalCommandBlockMarkdown,
  terminalCommandBlockFileName,
  type TerminalCommandBlock,
} from "@bb/domain";
import type { PromptDraftAttachment } from "@bb/client-core";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { appToast } from "@/components/ui/app-toast";
import type { TerminalCommandBlockAddToChatHandler } from "./ThreadTerminalView";

const MARKDOWN_MIME_TYPE = "text/markdown";

export interface UseTerminalCommandBlockAddToChatArgs {
  onAddToChat: (
    text: string,
    attachments?: readonly PromptDraftAttachment[],
  ) => void;
  projectId: string | null;
}

export function terminalCommandBlockQuote(
  block: TerminalCommandBlock,
  fileName: string,
): string {
  const location = block.cwd === null ? "" : ` in ${block.cwd}`;
  const exit =
    block.running || block.exitCode === null ? "" : ` (exit ${block.exitCode})`;
  return `Terminal: \`${block.command}\`${location}${exit}. Command and output attached as ${fileName}.`;
}

export function useTerminalCommandBlockAddToChat({
  onAddToChat,
  projectId,
}: UseTerminalCommandBlockAddToChatArgs):
  | TerminalCommandBlockAddToChatHandler
  | undefined {
  const uploadPromptAttachment = useUploadPromptAttachment();

  const addBlockToChat = useCallback<TerminalCommandBlockAddToChatHandler>(
    (block) => {
      if (projectId === null) {
        return;
      }
      const markdown = formatTerminalCommandBlockMarkdown({
        block,
        capturedAt: new Date().toISOString(),
      });
      const fileName = terminalCommandBlockFileName(block);
      const file = new File([markdown], fileName, {
        type: MARKDOWN_MIME_TYPE,
      });
      void uploadPromptAttachment
        .mutateAsync({ file, projectId })
        .then((attachment) => {
          onAddToChat(terminalCommandBlockQuote(block, fileName), [attachment]);
        })
        .catch(() => {
          appToast.warning("Added terminal output inline", {
            description:
              "Saving the terminal output as a file failed, so it was added to the message instead.",
          });
          onAddToChat(markdown);
        });
    },
    [onAddToChat, projectId, uploadPromptAttachment],
  );

  return projectId === null ? undefined : addBlockToChat;
}
