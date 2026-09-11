import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pluginListingDraftEntrySchema } from "@bb/server-contract";
import type { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

interface ListingDraftOptions extends JsonOutputOptions {
  file: string;
}

export function registerPluginListingCommands(
  plugin: Command,
  getUrl: () => string,
): void {
  const listing = plugin
    .command("listing")
    .description(
      "Manage your explicitly authored marketplace listing drafts and submissions",
    );

  listing
    .command("list")
    .description("List authored records and unread publication notices")
    .option("--json", "Output JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).plugins.listings.list();
        if (opts.json) return outputJson(opts, result);
        if (result.records.length === 0)
          console.log("No authored listing drafts.");
        for (const record of result.records) {
          console.log(
            `${record.pluginId}  ${record.entry.displayName}  ${record.lifecycle.status}`,
          );
        }
        for (const notice of result.notices) {
          console.log(
            `${notice.id}  ${notice.pluginName}: ${notice.kind}  ${notice.pullRequestUrl}`,
          );
        }
      }),
    );

  listing
    .command("draft <id>")
    .description(
      "Explicitly register a plugin you author, or update its saved marketplace v2 entry",
    )
    .requiredOption("--file <path>", "Marketplace entry JSON file")
    .option("--json", "Output JSON")
    .action(
      action(async (id: string, opts: ListingDraftOptions) => {
        const entry = pluginListingDraftEntrySchema.parse(
          JSON.parse(await readFile(resolve(opts.file), "utf8")),
        );
        const record = await createCliBbSdk(
          getUrl(),
        ).plugins.listings.saveDraft({
          pluginId: id,
          entry,
        });
        if (opts.json) return outputJson(opts, record);
        console.log(`${record.pluginId}: ${record.lifecycle.status}`);
      }),
    );

  listing
    .command("record-submission <id> <pull-request-url>")
    .description(
      "Verify and record an existing BB Community pull request; never opens one",
    )
    .option("--json", "Output JSON")
    .action(
      action(
        async (id: string, pullRequestUrl: string, opts: JsonOutputOptions) => {
          const record = await createCliBbSdk(
            getUrl(),
          ).plugins.listings.recordSubmission({
            pluginId: id,
            pullRequestUrl,
          });
          if (opts.json) return outputJson(opts, record);
          console.log(`${record.pluginId}: ${record.lifecycle.status}`);
        },
      ),
    );

  listing
    .command("consume-notice <notice-id>")
    .description("Acknowledge a publication notice exactly once")
    .option("--json", "Output JSON")
    .action(
      action(async (noticeId: string, opts: JsonOutputOptions) => {
        const consumed = await createCliBbSdk(
          getUrl(),
        ).plugins.listings.consumeNotice({ noticeId });
        if (opts.json) return outputJson(opts, { consumed });
        console.log(
          consumed
            ? "Notice acknowledged."
            : "Notice already acknowledged or unavailable.",
        );
      }),
    );
}
