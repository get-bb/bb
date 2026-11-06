import { flag } from "@bb/operations";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { CliValues } from "@bb/operations";
import {
  pluginMarketplaceListResponseSchema,
  pluginMarketplaceMutationResponseSchema,
  pluginMarketplaceRefreshResponseSchema,
  type PluginMarketplace,
} from "@bb/server-contract";
import { mountCommands, publicCommand } from "../operation-doors.js";
import { renderBorderlessTable } from "../table.js";

function normalizeSource(source: string): string {
  const trimmed = source.trim();
  return trimmed.startsWith("path:")
    ? `path:${resolve(trimmed.slice("path:".length))}`
    : trimmed;
}

function formatTimestamp(value: number | null): string {
  if (value === null) return "never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function printMarketplace(marketplace: PluginMarketplace): void {
  console.log(`${marketplace.name}  ${marketplace.displayName}`);
  console.log(`  source: ${marketplace.source}`);
  if (marketplace.subdirectory !== null) {
    console.log(`  subdirectory: ${marketplace.subdirectory}`);
  }
  if (marketplace.resolvedCommit !== null) {
    console.log(`  commit: ${marketplace.resolvedCommit}`);
  }
  console.log(`  entries: ${marketplace.entryCount}`);
  console.log(`  refreshed: ${formatTimestamp(marketplace.lastRefreshAt)}`);
  if (marketplace.lastError !== null) {
    console.log(`  last error: ${marketplace.lastError}`);
  }
}

function textValue(values: CliValues, name: string): string | undefined {
  const value = values.positionals[name] ?? values.options[name];
  return typeof value === "string" ? value : undefined;
}

const JSON_OPTION = flag("--json", "Output JSON");

const marketplaceCommands = [
  publicCommand("marketplaces.add", {
    path: ["marketplace", "add"],
    summary:
      "Add a marketplace from an https manifest URL, git:<url>[@<ref>], or path:<directory> (validates and caches the catalog; installs nothing)",
    positionals: [{ name: "source" }],
    options: [
      flag(
        "--subdirectory <path>",
        "Read marketplace.json from this directory of a git: repository instead of its root",
      ),
      JSON_OPTION,
    ],
    prepare: (values) => {
      const subdirectory = textValue(values, "subdirectory");
      return {
        source: normalizeSource(textValue(values, "source") ?? ""),
        ...(subdirectory === undefined ? {} : { subdirectory }),
      };
    },
    json: (output) =>
      pluginMarketplaceMutationResponseSchema.parse(output).marketplace,
    print: (output) => {
      const added =
        pluginMarketplaceMutationResponseSchema.parse(output).marketplace;
      console.log(`Added marketplace ${added.name}:`);
      printMarketplace(added);
      return `Adding a marketplace installs nothing. Install an entry with \`bb plugin install <id>@${added.name}\`.`;
    },
  }),
  publicCommand("marketplaces.list", {
    path: ["marketplace", "list"],
    summary: "List the marketplaces bb reads catalogs from",
    options: [JSON_OPTION],
    json: (output) =>
      pluginMarketplaceListResponseSchema.parse(output).marketplaces,
    print: (output) => {
      const { marketplaces } =
        pluginMarketplaceListResponseSchema.parse(output);
      const showSubdirectory = marketplaces.some(
        (entry) => entry.subdirectory !== null,
      );
      return renderBorderlessTable(
        {
          head: [
            "Name",
            "Source",
            ...(showSubdirectory ? ["Subdirectory"] : []),
            "Entries",
            "Refreshed",
          ],
          colWidths: [
            24,
            showSubdirectory ? 42 : 58,
            ...(showSubdirectory ? [16] : []),
            9,
            26,
          ],
          trimTrailingWhitespace: true,
        },
        marketplaces.map((entry) => [
          entry.official ? `${entry.name} (official)` : entry.name,
          entry.source,
          ...(showSubdirectory ? [entry.subdirectory ?? ""] : []),
          String(entry.entryCount),
          entry.lastError === null
            ? formatTimestamp(entry.lastRefreshAt)
            : `failed: ${entry.lastError}`,
        ]),
      );
    },
  }),
  publicCommand("marketplaces.refresh", {
    path: ["marketplace", "refresh"],
    summary:
      "Re-read one marketplace catalog, or every one of them. Discovery metadata and icons only: a refresh never installs, updates, or runs plugin code",
    positionals: [{ name: "name", field: "name", required: false }],
    options: [JSON_OPTION],
    json: (output) =>
      pluginMarketplaceRefreshResponseSchema.parse(output).results,
    print: (output) =>
      pluginMarketplaceRefreshResponseSchema
        .parse(output)
        .results.map((result) =>
          result.ok
            ? `${result.name}: ${result.marketplace.entryCount} entries`
            : `${result.name}: refresh failed (${result.error ?? "unknown error"}); keeping the last catalog`,
        ),
    exitCode: ({ results }, _input, json) =>
      !json && results.some((result) => !result.ok) ? 1 : 0,
  }),
  publicCommand("marketplaces.remove", {
    path: ["marketplace", "remove"],
    summary:
      "Forget a marketplace. bb-official and bb-community cannot be removed. Installed plugins keep their direct sources",
    positionals: [{ name: "name", field: "name" }],
    options: [JSON_OPTION],
    json: (output) => ({ convertedPluginIds: output.convertedPluginIds }),
    print: (removed, input) => {
      const lines = [`Removed marketplace ${input.name}.`];
      if (removed.convertedPluginIds.length > 0) {
        lines.push(
          `Kept as direct installs: ${removed.convertedPluginIds.join(", ")}`,
        );
      }
      return lines.join("\n");
    },
  }),
];

export function registerMarketplaceCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("marketplace")
    .description("Manage the plugin marketplaces bb reads catalogs from");
  mountCommands(program, marketplaceCommands, { getUrl });
}
