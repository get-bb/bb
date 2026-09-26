import type { Command } from "commander";
import type { PromptInput } from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { requireTextInput, TEXT_FILE_HELP_SUFFIX } from "../../text-input.js";
import { collectOption, outputJson } from "../helpers.js";
import { buildPromptInputs, uploadClientAttachmentInputs } from "./helpers.js";

interface DraftJsonOptions {
  json?: boolean;
}

interface DraftSetOptions extends DraftJsonOptions {
  messageFile?: string;
  file: string[];
  image: string[];
}

function printDraft(draft: readonly PromptInput[] | null): void {
  if (draft === null) {
    console.log("No draft");
    return;
  }
  const text = draft
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n\n");
  if (text.length > 0) console.log(text);
  for (const item of draft) {
    if (item.type === "localFile" || item.type === "localImage") {
      console.log(`Attachment: ${item.path}`);
    } else if (item.type === "image") {
      console.log(`Image: ${item.url}`);
    }
  }
}

export function registerDraftCommands(
  thread: Command,
  getUrl: () => string,
): void {
  const draft = thread
    .command("draft")
    .description(
      "Read or change a thread's saved, unsent draft message. A thread created with `bb thread spawn --draft` stays pending until a message is sent with `bb thread tell`",
    );
  draft
    .command("show <threadId>")
    .description("Print the thread's draft message")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: DraftJsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.get({
          threadId,
        });
        if (outputJson(opts, { threadId, draft: result.draft })) return;
        printDraft(result.draft);
      }),
    );
  draft
    .command("set <threadId> [message]")
    .description("Replace the thread's draft message")
    .option(
      "--message-file <path>",
      `Read the message from a file instead of [message]; ${TEXT_FILE_HELP_SUFFIX}`,
    )
    .option(
      "--file <path>",
      "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)",
      collectOption,
      [],
    )
    .option(
      "--image <path>",
      "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)",
      collectOption,
      [],
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          inlineMessage: string | undefined,
          opts: DraftSetOptions,
        ) => {
          const message = await requireTextInput({
            file: opts.messageFile,
            fileLabel: "--message-file",
            inline: inlineMessage,
            inlineLabel: "<message>",
          });
          const sdk = createCliBbSdk(getUrl());
          const input = await uploadClientAttachmentInputs({
            input: buildPromptInputs({
              message,
              files: opts.file,
              images: opts.image,
            }),
            resolveProjectId: async () =>
              (await sdk.threads.get({ threadId })).projectId,
            sdk,
          });
          const result = await sdk.threads.updateDraft({ threadId, input });
          if (outputJson(opts, result)) return;
          console.log(`Draft saved for thread ${threadId}`);
        },
      ),
    );
  draft
    .command("clear <threadId>")
    .description("Remove the thread's draft message")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: DraftJsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.updateDraft({
          threadId,
          input: [],
        });
        if (outputJson(opts, result)) return;
        console.log(`Draft cleared for thread ${threadId}`);
      }),
    );
}
