import { watch } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Command } from "commander";
import { z } from "zod";
import { scaffoldPlugin } from "@bb/templates/plugin-scaffold";
import { action } from "../action.js";
import { cliFetch } from "../client.js";
import {
  buildPluginApp,
  buildPluginServer,
  createPluginDevLoop,
} from "@bb/plugin-build";
import { runPluginCliCommand } from "../plugin-cli-proxy.js";
import { resolveBbCliVersion } from "../version.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";
import { renderBorderlessTable } from "../table.js";

interface PluginEntry {
  id: string;
  source: string;
  rootDir: string;
  version: string;
  enabled: boolean;
  status: string;
  statusDetail: string | null;
  handlerStats: {
    count: number;
    totalMs: number;
    maxMs: number;
    errorCount: number;
  };
  services: Array<{ name: string; state: string }>;
  schedules: Array<{
    name: string;
    cron: string;
    nextRunAt: number;
    lastRunAt: number | null;
    lastStatus: string | null;
    lastError: string | null;
  }>;
  cliCommand: { name: string; summary: string } | null;
}

interface PluginListResponse {
  enabled: boolean;
  plugins: PluginEntry[];
}

interface PluginMutationResult {
  ok: boolean;
  error?: string;
  plugin?: PluginEntry;
  plugins?: PluginEntry[];
}

const pluginEntrySchema: z.ZodType<PluginEntry> = z.object({
  id: z.string(),
  source: z.string(),
  rootDir: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  status: z.string(),
  statusDetail: z.string().nullable(),
  handlerStats: z.object({
    count: z.number(),
    totalMs: z.number(),
    maxMs: z.number(),
    errorCount: z.number(),
  }),
  services: z.array(z.object({ name: z.string(), state: z.string() })),
  schedules: z.array(
    z.object({
      name: z.string(),
      cron: z.string(),
      nextRunAt: z.number(),
      lastRunAt: z.number().nullable(),
      lastStatus: z.string().nullable(),
      lastError: z.string().nullable(),
    }),
  ),
  cliCommand: z.object({ name: z.string(), summary: z.string() }).nullable(),
});

const pluginMutationResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  plugin: pluginEntrySchema.optional(),
  plugins: z.array(pluginEntrySchema).optional(),
});

const marketplaceViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  source: z.string(),
  resolvedCommit: z.string().optional(),
  pluginCount: z.number(),
  lastRefreshAt: z.union([z.string(), z.number()]).optional(),
  lastAttemptAt: z.union([z.string(), z.number()]).optional(),
  lastError: z.string().optional(),
  enabled: z.boolean(),
  scope: z.enum(["official", "user"]),
  autoCheck: z.boolean(),
  autoApply: z.boolean(),
});

const marketplaceListSchema = z.object({
  marketplaces: z.array(marketplaceViewSchema),
});
const marketplaceMutationSchema = z.object({
  marketplace: marketplaceViewSchema,
});
const marketplaceErrorSchema = z.object({
  error: z.string(),
  affectedPlugins: z
    .array(z.object({ id: z.string(), version: z.string() }))
    .optional(),
});
const marketplaceRemoveSchema = z.object({
  kept: z.array(z.string()),
  uninstalled: z.array(z.string()),
});
const marketplaceSearchResultSchema = z.object({
  marketplaceId: z.string(),
  entryId: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: z.string().optional(),
  source: z.string(),
  installed: z.boolean(),
  compatible: z.boolean(),
  incompatibleReason: z.string().optional(),
});
const marketplaceSearchSchema = z.object({
  results: z.array(marketplaceSearchResultSchema),
});

const autoApplyResultSchema = z.object({ autoApply: z.boolean() }).strict();
const marketplaceAutoPolicySchema = z
  .object({ autoCheck: z.boolean(), autoApply: z.boolean() })
  .strict();
const updateEventSchema = z
  .object({
    kind: z.enum([
      "check",
      "resolve",
      "download",
      "activate",
      "rollback",
      "auto-apply-skipped",
    ]),
    fromVersion: z.string().optional(),
    toVersion: z.string().optional(),
    outcome: z.string(),
    detail: z.string().optional(),
    at: z.number(),
  })
  .strict();
const pluginHistorySchema = z
  .object({ events: z.array(updateEventSchema) })
  .strict();
const pluginAuditSchema = z
  .object({
    events: z.array(updateEventSchema.extend({ pluginId: z.string() })),
  })
  .strict();
const systemConfigAutoApplySchema = z.object({
  generalSettings: z.object({ pluginAutoApplyDisabled: z.boolean() }),
});

type MarketplaceView = z.infer<typeof marketplaceViewSchema>;
type MarketplaceSearchResult = z.infer<typeof marketplaceSearchResultSchema>;

async function callApi(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<{ status: number; value: unknown }> {
  const response = await cliFetch(`${baseUrl}/api/v1${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from /api/v1${path} (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  if (!response.ok && ![400, 404, 422].includes(response.status)) {
    throw new Error(`/api/v1${path} failed: HTTP ${response.status}`);
  }
  return { status: response.status, value };
}

async function listMarketplaces(baseUrl: string): Promise<MarketplaceView[]> {
  const response = await callApi(baseUrl, "/marketplaces", "GET");
  return marketplaceListSchema.parse(response.value).marketplaces;
}

async function searchMarketplaces(
  baseUrl: string,
  query: string,
): Promise<MarketplaceSearchResult[]> {
  const response = await callApi(
    baseUrl,
    `/marketplaces/search?q=${encodeURIComponent(query)}`,
    "GET",
  );
  return marketplaceSearchSchema.parse(response.value).results;
}

const pluginVersionSchema = z.object({
  version: z.string(),
  display: z.string(),
});

const pluginUpdateResultSchema = z.object({
  id: z.string(),
  outcome: z.enum([
    "current",
    "update-available",
    "pinned",
    "incompatible",
    "unavailable",
  ]),
  devMode: z.boolean().optional(),
  installed: pluginVersionSchema,
  candidate: pluginVersionSchema.optional(),
  blocked: z
    .object({ version: z.string(), reasons: z.array(z.string()) })
    .optional(),
  detail: z.string().optional(),
});

const pluginUpdatesSchema = z.object({
  results: z.array(pluginUpdateResultSchema),
});

const pluginUpdateMutationSchema = z.object({
  applied: z.boolean(),
  dryRun: z.boolean(),
  from: pluginVersionSchema,
  to: pluginVersionSchema.optional(),
  outcome: z.string(),
  detail: z.string().optional(),
});

const pluginUpdateErrorSchema = z.object({ error: z.string() });

const pluginSourceListSchema = z.object({
  plugins: z.array(z.object({ id: z.string(), source: z.string() })),
});

type PluginUpdateResult = z.infer<typeof pluginUpdateResultSchema>;

export function canDevelopPlugin(
  pluginsExperimentEnabled: boolean,
  entry: Pick<PluginEntry, "source">,
): boolean {
  return pluginsExperimentEnabled || entry.source.startsWith("builtin:");
}

interface PluginSettingDescriptor {
  type: "string" | "boolean" | "select" | "project";
  label: string;
  description?: string;
  secret?: true;
  default?: string | boolean;
  options?: string[];
}

interface PluginSettingsResult {
  ok: boolean;
  error?: string;
  schema?: Record<string, PluginSettingDescriptor>;
  values?: Record<string, unknown>;
}

async function callPlugins<T>(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await cliFetch(`${baseUrl}/api/v1/plugins${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from /api/v1/plugins${path} (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  // 400/404/422 carry structured { ok: false, error } (disabled experiment,
  // install/validation failures) — let them through so the caller can print
  // the reason.
  if (!response.ok && ![400, 404, 422].includes(response.status)) {
    throw new Error(`/api/v1/plugins${path} failed: HTTP ${response.status}`);
  }
  return parsed as T;
}

async function callPluginUpdates(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<z.infer<typeof pluginUpdatesSchema>> {
  const value = await callPlugins<unknown>(baseUrl, path, "POST", body);
  return pluginUpdatesSchema.parse(value);
}

async function callPluginUpdate(
  baseUrl: string,
  id: string,
  body: { dryRun?: boolean; latest?: boolean },
): Promise<
  | z.infer<typeof pluginUpdateMutationSchema>
  | z.infer<typeof pluginUpdateErrorSchema>
> {
  const value = await callPlugins<unknown>(
    baseUrl,
    `/${encodeURIComponent(id)}/update`,
    "POST",
    body,
  );
  const error = pluginUpdateErrorSchema.safeParse(value);
  if (error.success) return error.data;
  return pluginUpdateMutationSchema.parse(value);
}

async function callPluginSources(
  baseUrl: string,
): Promise<z.infer<typeof pluginSourceListSchema>> {
  const value = await callPlugins<unknown>(baseUrl, "", "GET");
  return pluginSourceListSchema.parse(value);
}

const UPDATE_STATUS_LABELS: Record<PluginUpdateResult["outcome"], string> = {
  current: "current",
  "update-available": "update available",
  pinned: "pinned",
  incompatible: "incompatible",
  unavailable: "unavailable",
};

function blockedSummary(result: PluginUpdateResult): string {
  if (!result.blocked) return "—";
  return `${result.blocked.version}: ${result.blocked.reasons.join("; ")}`;
}

function updateDetail(result: PluginUpdateResult): string {
  return result.detail ?? result.blocked?.reasons.join("; ") ?? "";
}

async function confirmPluginAction(
  prompt: string,
  refusal: string,
  yes: boolean,
): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY) {
    console.error(refusal);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log("Aborted.");
    process.exit(1);
  }
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatRelativeDate(value: string | number | undefined): string {
  if (value === undefined) return "never";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return String(value);
  const future = elapsed < 0;
  const absolute = Math.abs(elapsed);
  const units = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ] as const;
  const selected = units.find(([milliseconds]) => absolute >= milliseconds);
  const count = selected ? Math.max(1, Math.floor(absolute / selected[0])) : 0;
  const unit = selected?.[1] ?? "minute";
  const phrase = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return future ? `in ${phrase}` : `${phrase} ago`;
}

function formatAbsoluteDate(value: string | number | undefined): string {
  if (value === undefined) return "unknown date";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function parseOnOff(value: string, label: string): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  throw new Error(`${label} must be "on" or "off".`);
}

function assertEchoedBoolean(
  label: string,
  requested: boolean,
  echoed: boolean,
): void {
  if (requested !== echoed) {
    throw new Error(
      `${label} response did not match the requested state (requested ${requested ? "on" : "off"}, received ${echoed ? "on" : "off"}).`,
    );
  }
}

function eventVersion(fromVersion?: string, toVersion?: string): string {
  if (fromVersion && toVersion) return `${fromVersion} → ${toVersion}`;
  return fromVersion ?? toVersion ?? "—";
}

function printMarketplace(marketplace: MarketplaceView): void {
  console.log(`${marketplace.displayName} (${marketplace.name})`);
  console.log(`  source: ${marketplace.source}`);
  console.log(`  plugins: ${marketplace.pluginCount}`);
  console.log(
    `  last refreshed: ${formatRelativeDate(marketplace.lastRefreshAt)}`,
  );
  if (marketplace.resolvedCommit) {
    console.log(`  resolved commit: ${marketplace.resolvedCommit}`);
  }
  if (marketplace.lastError) {
    console.log(`  state: refresh failed — ${marketplace.lastError}`);
  }
}

function dualInterpretationError(source: string): string {
  return (
    `Could not resolve "${source}" as either a marketplace plugin or a path on disk. ` +
    "Use path:<path>, npm:<package>, or git:<url>@<ref> to choose an interpretation explicitly."
  );
}

function hasPathSyntax(source: string): boolean {
  return (
    source.includes("/") ||
    source.includes("\\") ||
    source.startsWith(".") ||
    source.startsWith("~")
  );
}

function isLocalMarketplaceSource(source: string): boolean {
  return (
    source.startsWith("path:") ||
    source.startsWith(".") ||
    source.startsWith("~") ||
    source.startsWith("/") ||
    source.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(source)
  );
}

async function existsOnDisk(source: string): Promise<boolean> {
  try {
    await access(resolve(source));
    return true;
  } catch {
    return false;
  }
}

type InstallIntent =
  | { kind: "source"; source: string; summary: string }
  | {
      kind: "marketplace";
      marketplace: MarketplaceView;
      entry: MarketplaceSearchResult;
    };

async function resolveInstallIntent(
  baseUrl: string,
  input: string,
): Promise<InstallIntent> {
  if (
    ["path:", "npm:", "git:", "builtin:"].some((prefix) =>
      input.startsWith(prefix),
    )
  ) {
    if (input.startsWith("path:")) {
      const path = resolve(input.slice(5));
      return {
        kind: "source",
        source: `path:${path}`,
        summary: `Installing ${path}`,
      };
    }
    return { kind: "source", source: input, summary: `Installing ${input}` };
  }
  if (hasPathSyntax(input)) {
    const path = resolve(input);
    return {
      kind: "source",
      source: `path:${path}`,
      summary: `Installing ${path}`,
    };
  }

  const at = input.indexOf("@");
  if (at > 0 && at === input.lastIndexOf("@")) {
    const entryId = input.slice(0, at);
    const marketplaceName = input.slice(at + 1);
    const marketplaces = await listMarketplaces(baseUrl);
    const marketplace = marketplaces.find(
      (candidate) => candidate.name === marketplaceName,
    );
    if (!marketplace) throw new Error(dualInterpretationError(input));
    const results = await searchMarketplaces(baseUrl, entryId);
    const entry = results.find(
      (candidate) =>
        candidate.marketplaceId === marketplace.id &&
        candidate.entryId === entryId,
    );
    if (!entry) throw new Error(dualInterpretationError(input));
    return { kind: "marketplace", marketplace, entry };
  }

  if (!input.includes("@")) {
    const results = (await searchMarketplaces(baseUrl, input)).filter(
      (candidate) => candidate.entryId === input,
    );
    if (results.length === 1) {
      const marketplaces = await listMarketplaces(baseUrl);
      const marketplace = marketplaces.find(
        (candidate) => candidate.id === results[0]?.marketplaceId,
      );
      if (!marketplace)
        throw new Error(`Marketplace for "${input}" is no longer available.`);
      return { kind: "marketplace", marketplace, entry: results[0]! };
    }
    if (results.length > 1) {
      const marketplaces = await listMarketplaces(baseUrl);
      const names = new Map(
        marketplaces.map((marketplace) => [marketplace.id, marketplace.name]),
      );
      const choices = results.map(
        (result) =>
          `  ${result.entryId}@${names.get(result.marketplaceId) ?? result.marketplaceId}`,
      );
      throw new Error(
        `Marketplace plugin "${input}" is ambiguous. Choose one:\n${choices.join("\n")}`,
      );
    }
    if (!(await existsOnDisk(input)))
      throw new Error(dualInterpretationError(input));
  }

  const path = resolve(input);
  return {
    kind: "source",
    source: `path:${path}`,
    summary: `Installing ${path}`,
  };
}

function printPlugin(plugin: PluginEntry): void {
  const state = plugin.enabled ? plugin.status : "disabled";
  const detail = plugin.statusDetail ? `  (${plugin.statusDetail})` : "";
  console.log(`${plugin.id}@${plugin.version}  ${state}${detail}`);
  console.log(`  source: ${plugin.source}`);
  const stats = plugin.handlerStats;
  if (stats && stats.count > 0) {
    const errors = stats.errorCount > 0 ? `, ${stats.errorCount} errors` : "";
    console.log(
      `  handlers: ${stats.count} calls / ${formatMs(stats.totalMs)} total / ${formatMs(stats.maxMs)} max${errors}`,
    );
  }
  for (const service of plugin.services ?? []) {
    console.log(`  service ${service.name}: ${service.state}`);
  }
  for (const schedule of plugin.schedules ?? []) {
    const last = schedule.lastStatus ? `, last: ${schedule.lastStatus}` : "";
    const error = schedule.lastError ? ` (${schedule.lastError})` : "";
    console.log(
      `  schedule ${schedule.name} (${schedule.cron}): next ${new Date(schedule.nextRunAt).toISOString()}${last}${error}`,
    );
  }
  if (plugin.cliCommand) {
    console.log(
      `  command: bb ${plugin.cliCommand.name} — ${plugin.cliCommand.summary}`,
    );
  }
}

function exitWithError(result: { error?: string }): never {
  console.error(result.error ?? "Command failed");
  process.exit(1);
}

function printSettings(result: PluginSettingsResult): void {
  const schema = result.schema ?? {};
  const values = result.values ?? {};
  const keys = Object.keys(schema);
  if (keys.length === 0) {
    console.log("This plugin declares no settings.");
    return;
  }
  for (const key of keys) {
    const descriptor = schema[key];
    if (!descriptor) continue;
    const meta = [
      descriptor.type,
      ...(descriptor.secret ? ["secret"] : []),
      ...(descriptor.options
        ? [`options: ${descriptor.options.join("|")}`]
        : []),
    ].join(", ");
    let display: string;
    if (descriptor.secret) {
      const value = values[key] as { set?: boolean } | undefined;
      display = value?.set ? "[set]" : "[not set]";
    } else {
      const value = values[key];
      display = value === undefined ? "(unset)" : JSON.stringify(value);
    }
    console.log(`${key} = ${display}  (${meta})`);
    console.log(
      `  ${descriptor.label}${descriptor.description ? ` — ${descriptor.description}` : ""}`,
    );
  }
}

/** Parse a CLI string into the descriptor's value type, or exit with usage. */
function parseSettingValue(
  descriptor: PluginSettingDescriptor,
  key: string,
  raw: string,
): string | boolean {
  if (descriptor.type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    console.error(`Setting "${key}" is a boolean — pass true or false.`);
    process.exit(1);
  }
  if (descriptor.type === "select" && !descriptor.options?.includes(raw)) {
    console.error(
      `Setting "${key}" must be one of: ${descriptor.options?.join(", ") ?? ""}`,
    );
    process.exit(1);
  }
  return raw;
}

export function registerPluginCommands(
  program: Command,
  getUrl: () => string,
): void {
  const plugin = program
    .command("plugin")
    .description("Manage BB plugins (experimental)")
    // Required (with the program's enablePositionalOptions) for `run` to
    // pass flags after <id> through to the plugin command untouched.
    .enablePositionalOptions();

  const marketplace = plugin
    .command("marketplace")
    .description("Manage plugin marketplaces");

  marketplace
    .command("add <source>")
    .description("Add and refresh a plugin marketplace")
    .option("--name <name>", "Set the marketplace name")
    .option("--yes", "Skip the trust confirmation for a remote marketplace")
    .action(
      action(async (source: string, opts: { name?: string; yes?: boolean }) => {
        if (!isLocalMarketplaceSource(source)) {
          console.log(
            "Marketplace catalogs can introduce full-trust plugin code. Adding this marketplace installs NOTHING.",
          );
          await confirmPluginAction(
            "Trust and add this marketplace?",
            "Refusing to add a remote marketplace without confirmation — re-run with --yes.",
            opts.yes === true,
          );
        }
        const response = await callApi(getUrl(), "/marketplaces", "POST", {
          source,
          ...(opts.name === undefined ? {} : { name: opts.name }),
        });
        const error = marketplaceErrorSchema.safeParse(response.value);
        if (response.status === 422 && error.success) exitWithError(error.data);
        printMarketplace(
          marketplaceMutationSchema.parse(response.value).marketplace,
        );
      }),
    );

  marketplace
    .command("list")
    .description("List configured plugin marketplaces")
    .option("--json", "Output the raw marketplace views as JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const response = await callApi(getUrl(), "/marketplaces", "GET");
        const result = marketplaceListSchema.parse(response.value);
        const { marketplaces } = result;
        if (opts.json) {
          outputJson(opts, result);
          return;
        }
        if (marketplaces.length === 0) {
          console.log("No plugin marketplaces configured.");
          return;
        }
        const rows = marketplaces.map((entry) => [
          entry.name,
          entry.scope,
          entry.autoCheck ? "on" : "off",
          entry.autoApply ? "on" : "off",
          entry.source,
          String(entry.pluginCount),
          formatRelativeDate(entry.lastRefreshAt),
          entry.lastError
            ? `refresh failed: using cached catalog from ${formatAbsoluteDate(entry.lastRefreshAt)}`
            : "ok",
        ]);
        console.log(
          renderBorderlessTable(
            {
              head: [
                "Name",
                "Scope",
                "Auto-check",
                "Auto-apply",
                "Source",
                "Plugins",
                "Last refreshed",
                "State",
              ],
              colWidths: [22, 10, 12, 12, 44, 10, 20, 62],
              trimTrailingWhitespace: true,
            },
            rows,
          ),
        );
      }),
    );

  marketplace
    .command("auto <name>")
    .description("Set automatic update checking and application policy")
    .option("--check <on|off>", "Enable or disable automatic update checks")
    .option("--apply <on|off>", "Enable or disable automatic application")
    .action(
      action(async (name: string, opts: { check?: string; apply?: string }) => {
        if (opts.check === undefined && opts.apply === undefined) {
          throw new Error(
            "Pass at least one of --check on|off or --apply on|off.",
          );
        }
        const marketplaces = await listMarketplaces(getUrl());
        const entry = marketplaces.find((candidate) => candidate.name === name);
        if (!entry) throw new Error(`Unknown marketplace "${name}".`);
        const requested = {
          autoCheck:
            opts.check === undefined
              ? entry.autoCheck
              : parseOnOff(opts.check, "--check"),
          autoApply:
            opts.apply === undefined
              ? entry.autoApply
              : parseOnOff(opts.apply, "--apply"),
        };
        const response = await callApi(
          getUrl(),
          `/marketplaces/${encodeURIComponent(entry.id)}/auto-policy`,
          "POST",
          requested,
        );
        const error = marketplaceErrorSchema.safeParse(response.value);
        if (response.status === 422 && error.success) exitWithError(error.data);
        const result = marketplaceAutoPolicySchema.parse(response.value);
        assertEchoedBoolean(
          "auto-check",
          requested.autoCheck,
          result.autoCheck,
        );
        assertEchoedBoolean(
          "auto-apply",
          requested.autoApply,
          result.autoApply,
        );
        console.log(`Auto-check: ${result.autoCheck ? "on" : "off"}`);
        console.log(`Auto-apply: ${result.autoApply ? "on" : "off"}`);
        if (entry.scope === "official" && result.autoApply) {
          console.log(
            "Note: official marketplace auto-apply remains limited to compatible, non-major updates.",
          );
        }
      }),
    );

  marketplace
    .command("update [name]")
    .description("Refresh one plugin marketplace, or all marketplaces")
    .action(
      action(async (name: string | undefined) => {
        const marketplaces = await listMarketplaces(getUrl());
        const selected =
          name === undefined
            ? marketplaces
            : marketplaces.filter((entry) => entry.name === name);
        if (name !== undefined && selected.length === 0) {
          console.error(`Unknown marketplace "${name}".`);
          process.exit(1);
        }
        let failed = false;
        for (const entry of selected) {
          const response = await callApi(
            getUrl(),
            `/marketplaces/${encodeURIComponent(entry.id)}/refresh`,
            "POST",
          );
          const error = marketplaceErrorSchema.safeParse(response.value);
          if (response.status === 422 && error.success) {
            failed = true;
            console.error(`${entry.name}: ${error.data.error}`);
            console.error("Last-known-good cached catalog is retained.");
            continue;
          }
          printMarketplace(
            marketplaceMutationSchema.parse(response.value).marketplace,
          );
        }
        if (failed) process.exit(1);
      }),
    );

  marketplace
    .command("remove <name>")
    .description("Remove a plugin marketplace")
    .option("--keep-all", "Keep affected plugins as direct installs")
    .option("--uninstall-all", "Uninstall every affected plugin")
    .action(
      action(
        async (
          name: string,
          opts: { keepAll?: boolean; uninstallAll?: boolean },
        ) => {
          if (opts.keepAll && opts.uninstallAll) {
            console.error("Choose only one of --keep-all or --uninstall-all.");
            process.exit(1);
          }
          const marketplaces = await listMarketplaces(getUrl());
          const entry = marketplaces.find(
            (candidate) => candidate.name === name,
          );
          if (!entry) {
            console.error(`Unknown marketplace "${name}".`);
            process.exit(1);
          }
          const remove = (
            dispositions: Array<{
              pluginId: string;
              action: "keep" | "uninstall";
            }>,
          ) =>
            callApi(
              getUrl(),
              `/marketplaces/${encodeURIComponent(entry.id)}`,
              "DELETE",
              { dispositions },
            );
          let response = await remove([]);
          if (response.status === 422) {
            const error = marketplaceErrorSchema.parse(response.value);
            const affected = error.affectedPlugins ?? [];
            if (affected.length === 0) exitWithError(error);
            let dispositions: Array<{
              pluginId: string;
              action: "keep" | "uninstall";
            }>;
            if (opts.keepAll || opts.uninstallAll) {
              const policy = opts.keepAll ? "keep" : "uninstall";
              dispositions = affected.map((plugin) => ({
                pluginId: plugin.id,
                action: policy,
              }));
            } else {
              if (!process.stdin.isTTY) exitWithError(error);
              const rl = createInterface({
                input: process.stdin,
                output: process.stdout,
              });
              dispositions = [];
              for (const plugin of affected) {
                const answer = (
                  await rl.question(
                    `${plugin.id}@${plugin.version}: keep as a direct install or uninstall? [k/u] `,
                  )
                )
                  .trim()
                  .toLowerCase();
                if (!["k", "keep", "u", "uninstall"].includes(answer)) {
                  rl.close();
                  console.error("Please answer keep (k) or uninstall (u).");
                  process.exit(1);
                }
                dispositions.push({
                  pluginId: plugin.id,
                  action:
                    answer === "k" || answer === "keep" ? "keep" : "uninstall",
                });
              }
              rl.close();
            }
            response = await remove(dispositions);
          }
          const error = marketplaceErrorSchema.safeParse(response.value);
          if (response.status === 422 && error.success)
            exitWithError(error.data);
          const removed = marketplaceRemoveSchema.parse(response.value);
          console.log(`Removed marketplace ${name}.`);
          if (removed.kept.length > 0)
            console.log(`Kept: ${removed.kept.join(", ")}`);
          if (removed.uninstalled.length > 0)
            console.log(`Uninstalled: ${removed.uninstalled.join(", ")}`);
        },
      ),
    );

  plugin
    .command("search <query>")
    .description("Search configured plugin marketplaces")
    .action(
      action(async (query: string) => {
        const [results, marketplaces] = await Promise.all([
          searchMarketplaces(getUrl(), query),
          listMarketplaces(getUrl()),
        ]);
        const names = new Map(
          marketplaces.map((entry) => [entry.id, entry.name]),
        );
        const rows = results.map((result) => [
          result.displayName,
          result.description,
          names.get(result.marketplaceId) ?? result.marketplaceId,
          result.installed
            ? "✓ installed"
            : result.compatible
              ? "compatible"
              : `requires newer bb${result.incompatibleReason ? `: ${result.incompatibleReason}` : ""}`,
        ]);
        console.log(
          renderBorderlessTable(
            {
              head: ["Name", "Description", "Marketplace", "Status"],
              colWidths: [28, 54, 24, 48],
              trimTrailingWhitespace: true,
            },
            rows,
          ),
        );
      }),
    );

  plugin
    .command("auto-apply <id> <on|off>")
    .description("Enable or disable automatic updates for one plugin")
    .action(
      action(async (id: string, state: string) => {
        const enabled = parseOnOff(state, "state");
        const response = await callApi(
          getUrl(),
          `/plugins/${encodeURIComponent(id)}/auto-apply`,
          "POST",
          { enabled },
        );
        const error = marketplaceErrorSchema.safeParse(response.value);
        if (response.status === 422 && error.success) exitWithError(error.data);
        const result = autoApplyResultSchema.parse(response.value);
        assertEchoedBoolean("auto-apply", enabled, result.autoApply);
        console.log(`Auto-apply for ${id}: ${result.autoApply ? "on" : "off"}`);

        const settingsResponse = await callApi(
          getUrl(),
          "/system/config",
          "GET",
        );
        const settings = systemConfigAutoApplySchema.parse(
          settingsResponse.value,
        );
        if (settings.generalSettings.pluginAutoApplyDisabled) {
          console.log(
            "Note: organization policy currently disables auto-apply and overrides this plugin setting.",
          );
        }
      }),
    );

  plugin
    .command("history [id]")
    .description("Show plugin update history or the cross-plugin audit feed")
    .option("--all", "Show update events for all plugins")
    .option("--limit <number>", "Limit the cross-plugin audit feed", "50")
    .option("--json", "Output the raw response as JSON")
    .action(
      action(
        async (
          id: string | undefined,
          opts: JsonOutputOptions & { all?: boolean; limit: string },
        ) => {
          if ((id === undefined) === (opts.all !== true)) {
            throw new Error("Pass a plugin id or --all, but not both.");
          }
          const limit = Number(opts.limit);
          if (!Number.isInteger(limit) || limit < 1) {
            throw new Error("--limit must be a positive integer.");
          }
          const path =
            opts.all === true
              ? `/plugins/updates/audit?limit=${limit}`
              : `/plugins/${encodeURIComponent(id ?? "")}/history`;
          const response = await callApi(getUrl(), path, "GET");
          const error = marketplaceErrorSchema.safeParse(response.value);
          if (response.status === 422 && error.success)
            exitWithError(error.data);
          let rows: string[][];
          if (opts.all === true) {
            const result = pluginAuditSchema.parse(response.value);
            if (opts.json) {
              outputJson(opts, result);
              return;
            }
            rows = result.events.map((event) => [
              new Date(event.at).toISOString(),
              event.pluginId,
              event.kind,
              eventVersion(event.fromVersion, event.toVersion),
              event.outcome,
              event.detail ?? "",
            ]);
          } else {
            const result = pluginHistorySchema.parse(response.value);
            if (opts.json) {
              outputJson(opts, result);
              return;
            }
            rows = result.events.map((event) => [
              new Date(event.at).toISOString(),
              event.kind,
              eventVersion(event.fromVersion, event.toVersion),
              event.outcome,
              event.detail ?? "",
            ]);
          }
          console.log(
            renderBorderlessTable(
              {
                head: [
                  "Time",
                  ...(opts.all ? ["Plugin"] : []),
                  "Kind",
                  "From → to",
                  "Outcome",
                  "Detail",
                ],
                colWidths: opts.all
                  ? [26, 24, 22, 24, 20, 50]
                  : [26, 22, 24, 20, 50],
                trimTrailingWhitespace: true,
              },
              rows,
            ),
          );
        },
      ),
    );

  plugin
    .command("list")
    .description("List installed plugins and their status")
    .option("--json", "Output JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const result = await callPlugins<PluginListResponse>(
          getUrl(),
          "",
          "GET",
        );
        if (opts.json) {
          outputJson(opts, result);
          return;
        }
        if (!result.enabled) {
          console.log(
            'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
          );
        }
        if (result.plugins.length === 0) {
          console.log("No plugins installed.");
          return;
        }
        for (const entry of result.plugins) {
          printPlugin(entry);
        }
      }),
    );

  plugin
    .command("install <source>")
    .description(
      "Install a plugin from a local path, builtin:<name>, git:<url>@<ref>, or npm:<name>@<version> (managed sources validate engines ranges and build artifacts; builtin ids are reserved)",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--version <range>", "Select a marketplace plugin version or range")
    .option("--json", "Output JSON")
    .action(
      action(
        async (
          source: string,
          opts: JsonOutputOptions & { yes?: boolean; version?: string },
        ) => {
          const intent = await resolveInstallIntent(getUrl(), source);
          let summary =
            intent.kind === "source"
              ? intent.summary
              : `Installing ${intent.entry.displayName}@${opts.version ?? "latest"} from marketplace ${intent.marketplace.name} (${intent.entry.source})`;
          if (opts.version !== undefined && intent.kind !== "marketplace") {
            console.error("--version is only valid for marketplace installs.");
            process.exit(1);
          }
          if (intent.kind === "source" && intent.source.startsWith("path:")) {
            const path = intent.source.slice(5);
            // Best effort — a missing/invalid manifest is the server's
            // error to report after confirmation.
            try {
              const pkg = JSON.parse(
                await readFile(join(path, "package.json"), "utf8"),
              ) as { name?: unknown; version?: unknown };
              if (typeof pkg.name === "string") {
                summary = `Installing ${pkg.name}@${typeof pkg.version === "string" ? pkg.version : "?"} from ${path}`;
              }
            } catch {
              // fall through to the bare path summary
            }
          }
          console.log(summary);
          console.log(
            "Plugins are full-trust code running inside the BB server. " +
              "They can read all local BB data, including other plugins' secrets.",
          );
          if (!opts.yes) {
            if (!process.stdin.isTTY) {
              console.error(
                "Refusing to install without confirmation — re-run with --yes.",
              );
              process.exit(1);
            }
            const rl = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const answer = (await rl.question("Install? [y/N] "))
              .trim()
              .toLowerCase();
            rl.close();
            if (answer !== "y" && answer !== "yes") {
              console.log("Aborted.");
              process.exit(1);
            }
          }
          const value = await callPlugins<unknown>(
            getUrl(),
            "/install",
            "POST",
            intent.kind === "source"
              ? { source: intent.source }
              : {
                  marketplace: {
                    marketplaceId: intent.marketplace.id,
                    entryId: intent.entry.entryId,
                  },
                  ...(opts.version === undefined
                    ? {}
                    : { version: opts.version }),
                },
          );
          const result = pluginMutationResultSchema.parse(value);
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok || !result.plugin) exitWithError(result);
          console.log("Installed:");
          printPlugin(result.plugin);
        },
      ),
    );

  plugin
    .command("outdated")
    .description("Check installed plugins for compatible updates")
    .option("--json", "Output the raw update results as JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const { results } = await callPluginUpdates(
          getUrl(),
          "/updates/check",
          {},
        );
        if (opts.json) {
          outputJson(opts, results);
          return;
        }
        const rows = results.map((result) => [
          result.id,
          result.installed.display,
          result.candidate?.display ?? "—",
          blockedSummary(result),
          `${UPDATE_STATUS_LABELS[result.outcome]}${result.devMode ? " [dev build: engines.bb not enforced]" : ""}`,
        ]);
        console.log(
          renderBorderlessTable(
            {
              head: [
                "Plugin",
                "Installed",
                "Latest compatible",
                "Blocked newer",
                "Status",
              ],
              colWidths: [22, 20, 22, 42, 54],
              trimTrailingWhitespace: true,
            },
            rows,
          ),
        );
      }),
    );

  plugin
    .command("update [id]")
    .description("Update one plugin, or all plugins with --all")
    .option("--all", "Update every plugin with a compatible update")
    .option("--dry-run", "Show the selected updates without changing plugins")
    .option(
      "--latest",
      "Widen one plugin's pinned/range source to the latest compatible version",
    )
    .option("--yes", "Skip confirmation prompts")
    .action(
      action(
        async (
          id: string | undefined,
          opts: {
            all?: boolean;
            dryRun?: boolean;
            latest?: boolean;
            yes?: boolean;
          },
        ) => {
          if ((id === undefined) === !opts.all) {
            console.error("Specify exactly one plugin id or --all.");
            process.exit(1);
          }
          if (opts.all && opts.latest) {
            console.error("--latest is only valid when updating one plugin.");
            process.exit(1);
          }

          const { results } = await callPluginUpdates(
            getUrl(),
            "/updates/check",
            id === undefined ? {} : { id },
          );
          const sources = new Map<string, string>();
          if (
            results.some(
              (result) => result.outcome === "update-available" || opts.latest,
            )
          ) {
            const list = await callPluginSources(getUrl());
            for (const entry of list.plugins)
              sources.set(entry.id, entry.source);
          }

          for (const result of results) {
            const source = sources.get(result.id) ?? "unknown source";
            const detail = updateDetail(result);
            const shouldAttempt =
              result.outcome === "update-available" ||
              (opts.latest === true && result.outcome === "pinned");

            if (!shouldAttempt) {
              if (result.outcome === "pinned") {
                console.log(
                  `${result.id}: skipped — pinned${detail ? ` (${detail})` : ""}; use --latest to widen the source intent.`,
                );
              } else if (result.outcome === "incompatible") {
                console.log(
                  `${result.id}: skipped — incompatible${detail ? `: ${detail}` : "."}`,
                );
              } else if (result.outcome === "unavailable") {
                console.log(
                  `${result.id}: skipped — unavailable${detail ? `: ${detail}` : "."}`,
                );
              } else {
                console.log(
                  `${result.id}: current (${result.installed.display}).`,
                );
              }
              continue;
            }

            const target = result.candidate?.display ?? "latest compatible";
            if (opts.latest) {
              console.log(
                `${result.id} source intent: ${source} → latest compatible`,
              );
              if (!opts.dryRun) {
                await confirmPluginAction(
                  "Change source intent?",
                  "Refusing to change source intent without confirmation — re-run with --yes.",
                  opts.yes === true,
                );
              }
            }

            if (opts.dryRun) {
              console.log(
                `${result.id}: dry run — would select ${target} from ${source}, activate ${result.installed.display} → ${target}.`,
              );
            } else {
              console.log(
                `${result.id}: ${result.installed.display} → ${target} from ${source}. Plugins are full-trust code.`,
              );
              await confirmPluginAction(
                "Update and activate?",
                "Refusing to update without confirmation — re-run with --yes.",
                opts.yes === true,
              );
            }

            const mutation = await callPluginUpdate(getUrl(), result.id, {
              ...(opts.dryRun ? { dryRun: true } : {}),
              ...(opts.latest ? { latest: true } : {}),
            });
            if ("error" in mutation) exitWithError(mutation);
            if (mutation.dryRun) {
              console.log(
                `${result.id}: would update ${mutation.from.display} → ${mutation.to?.display ?? target}${mutation.detail ? ` — ${mutation.detail}` : ""}`,
              );
            } else if (mutation.applied) {
              console.log(
                `${result.id}: updated and activated ${mutation.from.display} → ${mutation.to?.display ?? target}.`,
              );
            } else {
              console.log(
                `${result.id}: ${mutation.outcome}${mutation.detail ? ` — ${mutation.detail}` : ""}`,
              );
            }
          }
        },
      ),
    );

  plugin
    .command("new <name>")
    .description(
      "Scaffold a new plugin in ./bb-plugin-<name> (no server required)",
    )
    .option(
      "--app",
      "Also scaffold a frontend entry (app.tsx, built by `bb plugin build`)",
    )
    .action(
      action(async (name: string, opts: { app?: boolean }) => {
        const packageName = name.startsWith("bb-plugin-")
          ? name
          : `bb-plugin-${name}`;
        if (!/^bb-plugin-[a-z0-9][a-z0-9-]*$/.test(packageName)) {
          console.error(
            `Invalid plugin name "${name}" — use lowercase letters, digits, and dashes.`,
          );
          process.exit(1);
        }
        const targetDir = resolve(process.cwd(), packageName);
        await scaffoldPlugin({
          targetDir,
          packageName,
          bbVersion: resolveBbCliVersion(),
          app: opts.app ?? false,
        });
        console.log(`Created ${packageName}/`);
        // App scaffolds vendor components whose npm deps must be installed
        // before `bb plugin build` bundles them. Best-effort: authors need
        // npm anyway (design §5.5); a failure here just surfaces the manual
        // step.
        let installed = false;
        if (opts.app) {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          try {
            await promisify(execFile)(
              "npm",
              ["install", "--no-fund", "--no-audit"],
              { cwd: targetDir },
            );
            installed = true;
            console.log("Installed component dependencies (npm install).");
          } catch {
            console.warn(
              "Could not run npm install — run it in the plugin directory before `bb plugin build`.",
            );
          }
        }
        console.log("Next steps:");
        console.log(`  cd ${packageName}`);
        if (opts.app && !installed) {
          console.log("  npm install");
        }
        console.log("  bb plugin install .");
      }),
    );

  plugin
    .command("build [path]")
    .description(
      "Compile the plugin into dist/: the bb.server backend bundle (server.js, server.meta.json) and, when bb.app is declared, the frontend bundle (app.js, app.css, app.meta.json); each *.meta.json stamps SDK/identity metadata; no server required",
    )
    .action(
      action(async (path: string | undefined) => {
        const rootDir = resolve(process.cwd(), path ?? ".");
        const bbVersion = resolveBbCliVersion();
        // buildPluginServer errors legibly on a missing/invalid bb.server —
        // every plugin has one, so a headless plugin succeeds with just the
        // backend bundle (prebuilt distribution, design §6).
        const server = await buildPluginServer(rootDir, bbVersion);
        const files = [server.jsPath, server.mapPath, server.metaPath];
        let hasApp = false;
        try {
          const pkg = JSON.parse(
            await readFile(join(rootDir, "package.json"), "utf8"),
          ) as { bb?: { app?: unknown } };
          hasApp = typeof pkg.bb?.app === "string";
        } catch {
          // Unreachable in practice: buildPluginServer already read it.
        }
        if (hasApp) {
          const app = await buildPluginApp(rootDir, bbVersion);
          files.push(app.jsPath, app.cssPath, app.metaPath);
        }
        for (const file of files) {
          console.log(relative(process.cwd(), file));
        }
      }),
    );

  plugin
    .command("dev [path]")
    .description(
      "Watch a plugin's sources: rebuild its frontend bundle (if it has one) and reload it on every change (Ctrl+C to stop)",
    )
    .action(
      action(async (path: string | undefined) => {
        const rootDir = resolve(process.cwd(), path ?? ".");
        let manifest: { bb?: { server?: unknown; app?: unknown } };
        try {
          manifest = JSON.parse(
            await readFile(join(rootDir, "package.json"), "utf8"),
          ) as { bb?: { server?: unknown; app?: unknown } };
        } catch {
          console.error(
            `No readable package.json in ${rootDir} — run from a plugin directory or pass its path.`,
          );
          process.exit(1);
        }
        if (typeof manifest.bb?.server !== "string") {
          console.error(
            `${rootDir} is not a bb plugin — package.json has no "bb.server" entry.`,
          );
          process.exit(1);
        }
        const hasApp = typeof manifest.bb.app === "string";
        // The dev loop drives an *installed* plugin; match this directory
        // against the server's installed rows (realpath tolerates symlinked
        // checkouts).
        const realDir = await realpath(rootDir).catch(() => rootDir);
        const list = await callPlugins<PluginListResponse>(getUrl(), "", "GET");
        const entry = list.plugins.find(
          (candidate) =>
            candidate.rootDir === rootDir || candidate.rootDir === realDir,
        );
        if (!entry) {
          console.error(
            `This directory is not installed as a plugin — run \`bb plugin install ${path ?? "."}\` first, then re-run \`bb plugin dev\`.`,
          );
          process.exit(1);
        }
        if (!canDevelopPlugin(list.enabled, entry)) {
          console.error(
            'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
          );
          process.exit(1);
        }
        const loop = createPluginDevLoop({
          pluginId: entry.id,
          hasApp,
          buildApp: async () => {
            await buildPluginApp(rootDir, resolveBbCliVersion());
          },
          reloadPlugin: async () => {
            const result = await callPlugins<PluginMutationResult>(
              getUrl(),
              `/reload?id=${encodeURIComponent(entry.id)}`,
              "POST",
            );
            if (!result.ok) throw new Error(result.error ?? "reload failed");
          },
          log: (line) => console.log(line),
        });
        // Node's recursive fs.watch covers macOS/Windows natively and Linux
        // since Node 20 — zero extra dependencies for the CLI.
        const watcher = watch(
          rootDir,
          { recursive: true },
          (_event, filename) => {
            if (typeof filename === "string" && filename.length > 0) {
              loop.handleChange(filename);
            }
          },
        );
        console.log(
          `Watching ${rootDir} for plugin "${entry.id}"${hasApp ? " (frontend rebuild + reload on change)" : " (reload on change)"} — Ctrl+C to stop.`,
        );
        await new Promise<void>((resolveDone) => {
          const stop = (): void => {
            watcher.close();
            loop.dispose();
            resolveDone();
          };
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
      }),
    );

  plugin
    .command("reload [id]")
    .description("Reload one plugin, or all plugins")
    .option("--json", "Output JSON")
    .action(
      action(async (id: string | undefined, opts: JsonOutputOptions) => {
        const query = id ? `?id=${encodeURIComponent(id)}` : "";
        const result = await callPlugins<PluginMutationResult>(
          getUrl(),
          `/reload${query}`,
          "POST",
        );
        if (opts.json) {
          outputJson(opts, result);
          if (!result.ok) process.exit(1);
          return;
        }
        if (!result.ok) exitWithError(result);
        for (const entry of result.plugins ?? []) {
          printPlugin(entry);
        }
      }),
    );

  for (const [name, description] of [
    ["enable", "Enable an installed plugin"],
    ["disable", "Disable an installed plugin (its code is unloaded)"],
  ] as const) {
    plugin
      .command(`${name} <id>`)
      .description(description)
      .option("--json", "Output JSON")
      .action(
        action(async (id: string, opts: JsonOutputOptions) => {
          const result = await callPlugins<PluginMutationResult>(
            getUrl(),
            `/${encodeURIComponent(id)}/${name}`,
            "POST",
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok || !result.plugin) exitWithError(result);
          printPlugin(result.plugin);
        }),
      );
  }

  plugin
    .command("config <id> [action] [key] [value]")
    .description(
      "Show a plugin's settings, or change them: config <id> set <key> <value> | config <id> unset <key>",
    )
    .option("--json", "Output JSON")
    .action(
      action(
        async (
          id: string,
          actionName: string | undefined,
          key: string | undefined,
          value: string | undefined,
          opts: JsonOutputOptions,
        ) => {
          const settingsPath = `/${encodeURIComponent(id)}/settings`;
          if (actionName === undefined) {
            const result = await callPlugins<PluginSettingsResult>(
              getUrl(),
              settingsPath,
              "GET",
            );
            if (opts.json) {
              outputJson(opts, result);
              if (!result.ok) process.exit(1);
              return;
            }
            if (!result.ok) exitWithError(result);
            printSettings(result);
            return;
          }
          if (actionName !== "set" && actionName !== "unset") {
            console.error(
              `Unknown action "${actionName}" — use "set" or "unset".`,
            );
            process.exit(1);
          }
          if (
            key === undefined ||
            (actionName === "set" && value === undefined)
          ) {
            console.error(
              actionName === "set"
                ? "Usage: bb plugin config <id> set <key> <value>"
                : "Usage: bb plugin config <id> unset <key>",
            );
            process.exit(1);
          }
          let parsedValue: string | boolean | null = null;
          if (actionName === "set") {
            // Fetch the schema first so booleans/selects are parsed and
            // validated client-side with a friendly message.
            const current = await callPlugins<PluginSettingsResult>(
              getUrl(),
              settingsPath,
              "GET",
            );
            if (!current.ok || !current.schema) exitWithError(current);
            const descriptor = current.schema[key];
            if (!descriptor) {
              const known = Object.keys(current.schema).join(", ");
              console.error(
                `Unknown setting "${key}"${known ? ` — known settings: ${known}` : ""}`,
              );
              process.exit(1);
            }
            parsedValue = parseSettingValue(descriptor, key, value as string);
          }
          const result = await callPlugins<PluginSettingsResult>(
            getUrl(),
            settingsPath,
            "PUT",
            { values: { [key]: parsedValue } },
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok) exitWithError(result);
          printSettings(result);
        },
      ),
    );

  plugin
    .command("token <id>")
    .description(
      'Print the plugin\'s HTTP token (for routes registered with auth: "token")',
    )
    .option("--rotate", "Generate a new token, invalidating the old one")
    .option("--json", "Output JSON")
    .action(
      action(
        async (id: string, opts: JsonOutputOptions & { rotate?: boolean }) => {
          const result = await callPlugins<{
            ok: boolean;
            error?: string;
            token?: string;
          }>(
            getUrl(),
            `/${encodeURIComponent(id)}/token`,
            "POST",
            opts.rotate ? { rotate: true } : {},
          );
          if (opts.json) {
            outputJson(opts, result);
            if (!result.ok) process.exit(1);
            return;
          }
          if (!result.ok || !result.token) exitWithError(result);
          console.log(result.token);
        },
      ),
    );

  plugin
    .command("run <id> [args...]")
    .description(
      "Run a plugin's CLI command (explicit form of `bb <command> ...`)",
    )
    // Flags after <id> belong to the plugin command; parsing is plugin-owned.
    .passThroughOptions()
    .allowUnknownOption()
    .helpOption(false)
    .action(
      action(async (id: string, args: string[]) => {
        process.exit(await runPluginCliCommand(getUrl(), id, args ?? []));
      }),
    );

  plugin
    .command("logs <id>")
    .description("Print a plugin's log (bb.log output)")
    .option("-n, --lines <count>", "Number of lines to show", "100")
    .option("-f, --follow", "Poll for new lines every second (Ctrl+C to stop)")
    .action(
      action(async (id: string, opts: { lines: string; follow?: boolean }) => {
        const requested = Number.parseInt(opts.lines, 10);
        const tail =
          Number.isFinite(requested) && requested > 0 ? requested : 100;
        const fetchTail = async (count: number): Promise<string[]> => {
          const result = await callPlugins<{
            ok: boolean;
            error?: string;
            lines?: string[];
          }>(getUrl(), `/${encodeURIComponent(id)}/logs?tail=${count}`, "GET");
          if (!result.ok || !result.lines) exitWithError(result);
          return result.lines;
        };
        let lines = await fetchTail(tail);
        for (const line of lines) console.log(line);
        if (!opts.follow) return;
        for (;;) {
          await sleep(1000);
          const next = await fetchTail(1000);
          // Print the suffix that extends what we already showed: find the
          // last line printed so far and emit everything after it. When it
          // is gone (rotation or a fresh file), print the whole tail.
          const lastPrinted = lines.at(-1);
          const startAfter =
            lastPrinted === undefined ? -1 : next.lastIndexOf(lastPrinted);
          for (const line of next.slice(startAfter + 1)) console.log(line);
          lines = next;
        }
      }),
    );

  plugin
    .command("remove <id>")
    .description(
      "Remove an installed plugin (git:/npm: managed files are deleted; local path sources are left alone)",
    )
    .option("--json", "Output JSON")
    .action(
      action(async (id: string, opts: JsonOutputOptions) => {
        const result = await callPlugins<PluginMutationResult>(
          getUrl(),
          `/${encodeURIComponent(id)}`,
          "DELETE",
        );
        if (opts.json) {
          outputJson(opts, result);
          if (!result.ok) process.exit(1);
          return;
        }
        if (!result.ok) exitWithError(result);
        console.log(`Removed ${id}.`);
      }),
    );
}
