import type { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

export function registerSetupJobCommands(
  program: Command,
  getUrl: () => string,
): void {
  const group = program
    .command("setup-job")
    .description("Read or choose the recurring job offered during setup");
  group
    .command("show")
    .description(
      "Read the offered arm and opt-in state without recording exposure",
    )
    .option(
      "--timezone <zone>",
      "Schedule time zone",
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    .option("--json", "Print machine-readable JSON")
    .action(
      action(async (opts: { timezone: string; json?: boolean }) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).system.experimental_setupJob({ timezone: opts.timezone });
        if (outputJson(opts, result)) return;
        console.log(
          result.offer === null
            ? "No setup job is available."
            : `${result.offer.title} — ${result.offer.status} (arm ${result.offer.arm}, 10 pm Monday–Friday, ${result.offer.timezone})`,
        );
      }),
    );
  for (const [command, accepted] of [
    ["accept", true],
    ["dismiss", false],
  ] as const) {
    group
      .command(command)
      .description(
        accepted
          ? "Opt in to the currently offered recurring job"
          : "Continue without creating a recurring job",
      )
      .requiredOption(
        "--offer <id>",
        "Suggestion ID returned by setup-job show --json",
      )
      .option("--json", "Print machine-readable JSON")
      .action(
        action(async (opts: { offer: string; json?: boolean }) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).system.experimental_decideSetupJob({
            suggestionAnalyticsId: opts.offer,
            accepted,
          });
          if (!outputJson(opts, result))
            console.log(result.offer?.status ?? "No setup job is available.");
        }),
      );
  }
}
