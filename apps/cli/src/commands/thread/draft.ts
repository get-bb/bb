import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  draftContentSchema,
  threadOpenSplitSchema,
  type DraftContent,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { renderBorderlessTable } from "../../table.js";
import {
  confirmDestructiveAction,
  outputJson,
  type JsonOutputOptions,
} from "../helpers.js";

interface DraftContentOptions extends JsonOutputOptions {
  contentFile?: string;
  project?: string;
  section?: string;
  text?: string;
}

interface DraftCreateOptions extends DraftContentOptions {
  id?: string;
}

interface DraftRevisionOptions extends JsonOutputOptions {
  expectedRevision: string;
}

interface DraftUpdateOptions
  extends DraftContentOptions, DraftRevisionOptions {}

interface DraftDeleteOptions extends DraftRevisionOptions {
  yes?: boolean;
}

interface DraftListOptions extends JsonOutputOptions {
  project?: string;
  query?: string;
  includeEmpty?: boolean;
  limit?: string;
  offset?: string;
}

function parseInteger(value: string, flag: string, minimum: number): number {
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum
  ) {
    throw new Error(`${flag} must be an integer of at least ${minimum}.`);
  }
  return parsed;
}

function contentOptions(command: Command): Command {
  return command
    .option(
      "--text <text>",
      "Prompt text; use --content-file for text with mentions",
    )
    .option(
      "--project <id>",
      "Project destination (no implicit current project)",
    )
    .option("--section <id>", "Section destination")
    .option(
      "--content-file <path>",
      "Local JSON content object to replace all content",
    )
    .option("--json", "Print machine-readable JSON output");
}

function revisionOption(command: Command): Command {
  return command.requiredOption(
    "--expected-revision <number>",
    "Draft revision returned by show; refuses unseen edits",
  );
}

async function readContent(
  options: DraftContentOptions,
): Promise<DraftContent> {
  if (options.contentFile === undefined) return draftContentSchema.parse({});
  const contents = await readFile(options.contentFile, "utf8");
  return draftContentSchema.strict().parse(JSON.parse(contents));
}

function applyContentOptions(
  content: DraftContent,
  options: DraftContentOptions,
): DraftContent {
  if (
    options.text !== undefined &&
    options.text !== content.prompt.text &&
    content.prompt.mentions.length > 0
  ) {
    throw new Error(
      "Use --content-file to replace text with mentions and their positions together.",
    );
  }
  return draftContentSchema.parse({
    ...content,
    projectId: options.project ?? content.projectId,
    sectionId: options.section ?? content.sectionId,
    prompt: {
      ...content.prompt,
      text: options.text ?? content.prompt.text,
    },
  });
}

export function registerDraftCommands(
  program: Command,
  getUrl: () => string,
): void {
  const draft = program
    .command("draft")
    .description("Manage saved drafts with or without an app connected");

  draft
    .command("open <draft-id>")
    .description("Open a saved draft in connected apps")
    .option(
      "--split <placement>",
      "Open right, down, left, top, or replace; edge placements add panes through pane 8, then replace the focused pane",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          draftId: string,
          opts: JsonOutputOptions & { split?: string },
        ) => {
          const split =
            opts.split === undefined
              ? undefined
              : threadOpenSplitSchema.parse(opts.split);
          const result = await createCliBbSdk(getUrl()).drafts.open({
            draftId,
            ...(split === undefined ? {} : { split }),
          });
          if (
            outputJson(opts, {
              draftId,
              split: split ?? "replace",
              delivered: result.delivered,
            })
          )
            return;
          console.log(`Draft: ${draftId}`);
          console.log(`Split: ${split ?? "replace"}`);
          console.log(`Delivered: ${result.delivered}`);
        },
      ),
    );

  contentOptions(draft.command("create"))
    .description("Save a draft without starting a thread")
    .option("--id <draft-id>", "Stable creation identity for retry or import")
    .action(
      action(async (options: DraftCreateOptions) => {
        const content = applyContentOptions(
          await readContent(options),
          options,
        );
        const result = await createCliBbSdk(getUrl()).drafts.create({
          ...(options.id === undefined ? {} : { id: options.id }),
          content,
        });
        if (outputJson(options, result)) return;
        console.log(
          result.draft === null
            ? `${result.id} was already consumed or deleted.`
            : `Saved ${result.id} at revision ${result.draft.revision}.`,
        );
      }),
    );

  draft
    .command("list")
    .description("List saved drafts with text or attachments")
    .option("--project <id>", "Filter by project; defaults to all projects")
    .option("--query <text>", "Search prompt text and attachment names")
    .option("--include-empty", "Include blank and option-only drafts")
    .option("--limit <number>", "Maximum results (1–200; default 50)")
    .option("--offset <number>", "Pagination offset")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: DraftListOptions) => {
        const result = await createCliBbSdk(getUrl()).drafts.list({
          projectId: options.project,
          query: options.query,
          includeEmpty: options.includeEmpty,
          limit:
            options.limit === undefined
              ? undefined
              : parseInteger(options.limit, "--limit", 1),
          offset:
            options.offset === undefined
              ? undefined
              : parseInteger(options.offset, "--offset", 0),
        });
        if (outputJson(options, result)) return;
        if (result.drafts.length === 0) {
          console.log("No drafts.");
          return;
        }
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "REVISION", "PROJECT", "PROMPT"],
              colWidths: [
                Math.max(2, ...result.drafts.map((entry) => entry.id.length)),
                10,
                24,
                60,
              ],
              trimTrailingWhitespace: true,
            },
            result.drafts.map((entry) => [
              entry.id,
              String(entry.revision),
              entry.content.projectId ?? "—",
              entry.content.prompt.text.replace(/\s+/g, " "),
            ]),
          ),
        );
        if (result.nextOffset !== null) {
          console.error(`More drafts: use --offset ${result.nextOffset}.`);
        }
      }),
    );

  draft
    .command("show <draft-id>")
    .alias("get")
    .description("Inspect a draft's revision and complete content")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (draftId: string, options: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).drafts.get({ draftId });
        if (outputJson(options, result)) return;
        console.log(`${result.id} at revision ${result.revision}`);
        console.log(JSON.stringify(result.content, null, 2));
      }),
    );

  revisionOption(contentOptions(draft.command("update <draft-id>")))
    .description("Edit a known revision; unsupplied fields stay unchanged")
    .action(
      action(async (draftId: string, options: DraftUpdateOptions) => {
        const expectedRevision = parseInteger(
          options.expectedRevision,
          "--expected-revision",
          1,
        );
        if (
          options.contentFile === undefined &&
          options.text === undefined &&
          options.project === undefined &&
          options.section === undefined
        ) {
          throw new Error(
            "Provide --text, --project, --section or --content-file.",
          );
        }
        const sdk = createCliBbSdk(getUrl());
        let content: DraftContent;
        if (options.contentFile !== undefined) {
          content = await readContent(options);
        } else {
          const current = await sdk.drafts.get({ draftId });
          if (current.revision !== expectedRevision) {
            throw new Error(
              `Draft changed to revision ${current.revision}; inspect it before retrying.`,
            );
          }
          content = current.content;
        }
        const result = await sdk.drafts.update({
          draftId,
          expectedRevision,
          content: applyContentOptions(content, options),
        });
        if (outputJson(options, result)) return;
        console.log(`Saved ${result.id} at revision ${result.revision}.`);
      }),
    );

  revisionOption(draft.command("delete <draft-id>"))
    .description("Delete only the draft revision you inspected")
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (draftId: string, options: DraftDeleteOptions) => {
        const expectedRevision = parseInteger(
          options.expectedRevision,
          "--expected-revision",
          1,
        );
        if (
          !options.yes &&
          !(await confirmDestructiveAction(
            `Delete draft ${draftId}? This cannot be undone.`,
          ))
        ) {
          console.log("Aborted.");
          return;
        }
        const result = await createCliBbSdk(getUrl()).drafts.delete({
          draftId,
          expectedRevision,
        });
        if (outputJson(options, result)) return;
        console.log(`Deleted ${result.id} at revision ${result.revision}.`);
      }),
    );

  revisionOption(draft.command("submit <draft-id>"))
    .description("Start a thread once from an inspected draft revision")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (draftId: string, options: DraftRevisionOptions) => {
        const result = await createCliBbSdk(getUrl()).drafts.submit({
          draftId,
          expectedRevision: parseInteger(
            options.expectedRevision,
            "--expected-revision",
            1,
          ),
          origin: "cli",
        });
        if (outputJson(options, result)) return;
        console.log(`Submitted ${draftId} as thread ${result.thread.id}.`);
        if (result.draft !== null) {
          console.log(
            `Newer draft edits remain at revision ${result.draft.revision}.`,
          );
        }
      }),
    );
}
