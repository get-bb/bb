import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface GuideCommandOptions {
  json?: boolean;
}

export function registerGuideCommand(
  program: Command,
  getUrl: () => string = () => "",
): void {
  program
    .command("guide [chapter]")
    .description("Show the BB system overview and CLI guide")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (chapter: string | undefined, opts: GuideCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const rendered = sdk.guide.render({ chapter });
        if (chapter) {
          if (outputJson(opts, rendered)) return;
          console.log(rendered.content);
          return;
        }

        if (outputJson(opts, { overview: rendered.content })) return;
        console.log(rendered.content);
      }),
    );
}
