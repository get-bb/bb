import { Command, Option } from "commander";
import type { ReleaseNotes } from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface WhatsNewOptions {
  json?: boolean;
  since?: string;
  version?: string;
}

type ReleaseNotesBlock = ReleaseNotes["lede"][number];

function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
}

function blockLines(blocks: readonly ReleaseNotesBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "paragraph"
      ? [plainText(block.text)]
      : block.items.map((item) => `  - ${plainText(item)}`),
  );
}

export function formatReleaseNotes(release: ReleaseNotes): string {
  const lines = [
    [`bb ${release.version}`, release.date]
      .filter((part) => part !== null)
      .join(" · "),
  ];
  if (release.headline !== null) {
    lines.push(release.headline);
  }
  if (release.lede.length > 0) {
    lines.push("", ...blockLines(release.lede));
  }
  for (const section of release.sections) {
    lines.push("", section.title, ...blockLines(section.blocks));
  }
  return lines.join("\n");
}

export function registerWhatsNewCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("whats-new")
    .description(
      "Show release notes for the installed bb, without marking anything seen",
    )
    .addOption(
      new Option("--version <version>", "Show one release").conflicts("since"),
    )
    .option(
      "--since <version>",
      "Show every release after <version> up to the installed one, newest first",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: WhatsNewOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).system.experimental_releaseNotes({
          ...(opts.version === undefined ? {} : { version: opts.version }),
          ...(opts.since === undefined ? {} : { since: opts.since }),
        });
        if (outputJson(opts, result)) return;
        if (result.releases.length === 0) {
          console.log(
            `No releases after ${opts.since ?? result.installedVersion} up to the installed bb ${result.installedVersion}.`,
          );
          return;
        }
        console.log(result.releases.map(formatReleaseNotes).join("\n\n"));
      }),
    );
}
