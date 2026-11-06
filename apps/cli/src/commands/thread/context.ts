import type { Command } from "commander";
import { arg, flag } from "../../cli-door.js";
import { mountCommand, publicCommand } from "../../operation-doors.js";

function count(value: number): string {
  return value.toLocaleString("en-US");
}

export const threadContextCommand = publicCommand("threads.context", {
  path: ["thread", "context"],
  summary:
    "Show the latest recorded context window usage and available breakdown",
  positionals: { id: arg("[id]") },
  options: {
    self: flag("--self", "Use the current thread", {
      context: { field: "id", from: "threadId" },
    }),
  },
  print: (result) => {
    const usage = result.usage;
    if (!usage) return "Context usage is not available yet.";
    const lines = [
      `${usage.estimated ? "Estimated context" : "Context window"}: ${count(usage.usedTokens)} / ${count(usage.modelContextWindow)} tokens`,
    ];
    if (usage.cost) {
      lines.push(`Session cost: ${usage.cost.amount} ${usage.cost.currency}`);
    }
    if (!usage.snapshot) return lines;
    lines.push(`Captured: ${usage.snapshot.capturedAt}`);
    for (const category of usage.snapshot.categories) {
      const kind = category.kind === "used" ? "" : ` (${category.kind})`;
      lines.push(`${category.label}${kind}: ${count(category.tokens)}`);
      for (const entry of category.entries) {
        lines.push(`  ${entry.label}: ${count(entry.tokens)}`);
      }
    }
    return lines;
  },
});

export function registerContextCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadContextCommand, { getUrl });
}
