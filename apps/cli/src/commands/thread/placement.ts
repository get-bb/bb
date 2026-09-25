import { Command } from "commander";
import type { ThreadPlacementPreviewResult } from "@bb/sdk";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson } from "../helpers.js";

interface ThreadPlacementCommandOptions {
  json?: boolean;
  project: string;
  provider: string;
}

export function registerPlacementCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("placement")
    .description(
      "Show which machine a new thread without --machine would start on right now",
    )
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--provider <id>", "Provider ID for the thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThreadPlacementCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.placementPreview({
          projectId: opts.project,
          providerId: opts.provider,
        });
        if (outputJson(opts, result)) return;
        console.log(describePlacement(result));
        if (result.kind === "unavailable") return;
        for (const skip of result.skipped) {
          console.log(`  ${skip.hostName} skipped: ${skip.reason}`);
        }
      }),
    );
}

function describePlacement(result: ThreadPlacementPreviewResult): string {
  switch (result.kind) {
    case "host":
      return `${result.hostName} (${result.hostId})`;
    case "default":
      return "Server default: no placement plugin chose a ready machine";
    case "unavailable":
      return "Server default: no placement plugin is installed";
  }
}
