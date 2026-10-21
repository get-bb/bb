import { Command } from "commander";
import type { SystemLapsedResumeResult } from "@bb/sdk/node";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface ResumeOptions {
  json?: boolean;
}

function printResume(result: SystemLapsedResumeResult): void {
  console.log(
    result.lapsed
      ? "A return after 14 days away is available."
      : "No return after 14 days away is available.",
  );
  if (result.lastActivityAt !== null) {
    console.log(
      `Last activity: ${new Date(result.lastActivityAt).toISOString()}`,
    );
  }
  console.log(
    result.target === null
      ? "No unfinished thread to resume."
      : `Resume thread: ${result.target.threadId} (project ${result.target.projectId})`,
  );
  for (const thread of result.threads) {
    console.log(
      `${thread.reason === "waiting" ? "Waiting on you" : "Finished"}: ${thread.title} (${thread.threadId})`,
    );
  }
}

export function registerResumeCommands(
  program: Command,
  getUrl: () => string,
): void {
  const resume = program
    .command("resume")
    .description(
      "Inspect or claim the return to unfinished work after 14 days away",
    );

  resume
    .command("status", { isDefault: true })
    .description(
      "Read the lapsed state and last unfinished thread without claiming it",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ResumeOptions) => {
        const result =
          await createCliBbSdk(getUrl()).system.experimental_lapsedResume();
        if (outputJson(opts, result)) return;
        printResume(result);
      }),
    );

  resume
    .command("open")
    .description(
      "Claim this lapse once and print its target without opening a window",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ResumeOptions) => {
        const result =
          await createCliBbSdk(getUrl()).system.experimental_openLapsedResume();
        if (outputJson(opts, result)) return;
        printResume(result);
      }),
    );
}
