import { Command } from "commander";
import { dispatchHoldHolderSchema, type DispatchHoldHolder } from "@bb/domain";
import type { ThreadHoldListResult, ThreadHoldResult } from "@bb/sdk";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import { renderBorderlessTable } from "../../table.js";
import { outputJson, prependErrorContext } from "../helpers.js";
import {
  formatHoldCreatedAge,
  formatHoldResumeCountdown,
} from "./hold-time.js";

interface ThreadHoldsCommandOptions {
  json?: boolean;
  owner?: string;
  thread?: string;
}

interface ThreadHoldActionOptions {
  json?: boolean;
}

export function registerHoldCommands(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("holds")
    .description("List live dispatch holds")
    .option("--thread <id>", "Filter by thread ID")
    .option(
      "--owner <holder>",
      "Filter by holder: user, plugin:<plugin-id>, or core:<mechanism>",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThreadHoldsCommandOptions) => {
        const threadId = resolveExplicitIdFlag({
          flagName: "--thread",
          value: opts.thread,
        });
        const holder = parseHoldHolder(opts.owner);
        const holds = await createCliBbSdk(getUrl()).threads.holds.list({
          ...(threadId ? { threadId } : {}),
          ...(holder ? { holder } : {}),
        });
        if (outputJson(opts, holds)) return;
        if (holds.length === 0) {
          console.log("No holds found");
          return;
        }
        printHoldTable(holds);
      }),
    );

  parent
    .command("release <holdId>")
    .description("Release a held dispatch now")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (holdId: string, opts: ThreadHoldActionOptions) => {
        const sdk = createCliBbSdk(getUrl());
        let hold: ThreadHoldResult;
        try {
          hold = await sdk.threads.holds.release({ holdId });
        } catch (err: unknown) {
          throw prependErrorContext(`Failed to release hold ${holdId}`, err);
        }
        if (outputJson(opts, hold)) return;
        console.log(`Hold ${hold.id} released on thread ${hold.threadId}`);
      }),
    );

  parent
    .command("cancel-hold <holdId>")
    .description("Discard a held dispatch instead of running it")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (holdId: string, opts: ThreadHoldActionOptions) => {
        const sdk = createCliBbSdk(getUrl());
        let hold: ThreadHoldResult;
        try {
          hold = await sdk.threads.holds.cancel({ holdId });
        } catch (err: unknown) {
          throw prependErrorContext(`Failed to cancel hold ${holdId}`, err);
        }
        if (outputJson(opts, hold)) return;
        console.log(`Hold ${hold.id} cancelled on thread ${hold.threadId}`);
      }),
    );
}

/**
 * Holders are a closed prefixed set, so a typo fails here with the shape spelled
 * out rather than as an opaque 400 from the list route.
 */
function parseHoldHolder(
  value: string | undefined,
): DispatchHoldHolder | undefined {
  if (value === undefined) return undefined;
  const parsed = dispatchHoldHolderSchema.safeParse(value.trim());
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid --owner value '${value}'. Expected 'user', 'plugin:<plugin-id>', or 'core:<mechanism>'.`,
  );
}

const MAX_REASON_WIDTH = 40;

function printHoldTable(holds: ThreadHoldListResult): void {
  const now = Date.now();
  const rows = holds.map((hold) => [
    hold.id,
    hold.threadId,
    hold.holder,
    truncateCell(hold.reason, MAX_REASON_WIDTH),
    formatHoldResumeCountdown(hold.resumeAt, now),
    formatHoldCreatedAge(hold.createdAt, now),
  ]);
  const table = renderBorderlessTable(
    {
      head: ["ID", "Thread", "Holder", "Reason", "Resume", "Created"],
      colWidths: [
        columnWidth(rows, 0, 4),
        columnWidth(rows, 1, 6),
        columnWidth(rows, 2, 6),
        columnWidth(rows, 3, 6),
        columnWidth(rows, 4, 6),
        columnWidth(rows, 5, 7),
      ],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}

function columnWidth(
  rows: string[][],
  index: number,
  headWidth: number,
): number {
  return Math.max(headWidth, ...rows.map((row) => row[index].length));
}

function truncateCell(value: string, maxWidth: number): string {
  const singleLine = value.replace(/\s+/g, " ");
  if (singleLine.length <= maxWidth) return singleLine;
  return `${singleLine.slice(0, maxWidth - 1)}…`;
}
