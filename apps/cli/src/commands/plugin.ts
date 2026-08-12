import { watch } from "node:fs";
import { homedir } from "node:os";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Command } from "commander";
import { z } from "zod";
import { derivePluginId } from "@bb/domain";
import type {
  InstalledPlugin as PluginEntry,
  PluginApplyUpdateResult,
  PluginCatalogSearchResult,
  PluginUpdateCheckEntry as PluginUpdateResult,
} from "@bb/server-contract";
import { installedPluginSchema } from "@bb/server-contract";
import { BbHttpError } from "@bb/sdk";
import { parseDataDirEnvValue, resolveProdDataDir } from "@bb/config/runtime";
import { scaffoldPlugin, syncPluginTypes } from "@bb/templates/plugin-scaffold";
import { action } from "../action.js";
import { cliFetch, createCliBbSdk } from "../client.js";
import {
  buildPluginApp,
  buildPluginServer,
  createPluginDevLoop,
  PLUGIN_TOOLCHAIN_PINS,
  resolvePluginBuildToolchain,
  type PluginBuildToolchain,
} from "@bb/plugin-build";
import { runPluginCliCommand } from "../plugin-cli-proxy.js";
import { resolveBbCliVersion } from "../version.js";

import { outputJson, type JsonOutputOptions } from "./helpers.js";
import { renderBorderlessTable } from "../table.js";

export interface NewPluginTarget {
  packageName: string;
  directoryName: string;
}

export function resolveNewPluginTarget(name: string): NewPluginTarget | null {
  const packageName = name.startsWith("@")
    ? name
    : name.startsWith("bb-plugin-")
      ? name
      : `bb-plugin-${name}`;
  if (
    !/^(?:@[a-z0-9][a-z0-9-]*\/)?bb-plugin-[a-z0-9][a-z0-9-]*$/.test(
      packageName,
    )
  ) {
    return null;
  }
  return {
    packageName,
    directoryName: `bb-plugin-${derivePluginId(packageName)}`,
  };
}

/**
 * Where `bb plugin build`/`dev` cache the pinned esbuild/Tailwind set.
 *
 * The CLI ships no build toolchain, so the first build on a machine fetches
 * one. Honors BB_DATA_DIR (dev instances and tests set it) and otherwise uses
 * the production data dir, so the CLI and server share one cache.
 */
function toolchainBaseDir(): string {
  const configured = process.env.BB_DATA_DIR;
  const dataDir =
    configured === undefined || configured.trim().length === 0
      ? resolveProdDataDir({ homeDir: homedir() })
      : parseDataDirEnvValue({ homeDir: homedir(), rawDataDir: configured });
  return join(dataDir, "plugins");
}

async function cliBuildToolchain(): Promise<PluginBuildToolchain> {
  return resolvePluginBuildToolchain(toolchainBaseDir(), {
    onFetchStart: () => {
      const pins = Object.entries(PLUGIN_TOOLCHAIN_PINS)
        .map(([name, version]) => `${name}@${version}`)
        .join(", ");
      console.log("Downloading the plugin build toolchain (one time)…");
      console.log(`  ${pins}`);
    },
    // Without this the command sits silent for the whole download — measured at
    // 17s on a cold macOS cache against 1.6s once cached.
    onFetchDone: (elapsedMs) => {
      console.log(`Toolchain ready (${(elapsedMs / 1000).toFixed(1)}s)`);
    },
  });
}

const pluginMutationResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  plugin: installedPluginSchema.optional(),
  plugins: z.array(installedPluginSchema).optional(),
});
async function searchCatalog(
  baseUrl: string,
  query: string,
): Promise<PluginCatalogSearchResult[]> {
  return createCliBbSdk(baseUrl).plugins.catalog.search({ query });
}

const pluginSettingDescriptorSchema = z.object({
  type: z.enum(["string", "boolean", "select", "project"]),
  label: z.string(),
  description: z.string().optional(),
  secret: z.literal(true).optional(),
  default: z.union([z.string(), z.boolean()]).optional(),
  options: z.array(z.string()).optional(),
});
const pluginSettingsResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  schema: z.record(z.string(), pluginSettingDescriptorSchema).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
});
const pluginTokenResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  token: z.string().optional(),
});
const pluginLogsResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  lines: z.array(z.string()).optional(),
});
const pluginPackageSummarySchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
});
const pluginManifestSchema = z.object({
  bb: z
    .object({
      server: z.unknown().optional(),
      app: z.unknown().optional(),
    })
    .optional(),
});
const secretSettingValueSchema = z.object({ set: z.boolean().optional() });

/**
 * Read a plugin directory's manifest. Returns null when the directory has no
 * readable `package.json`, so callers can print their own guidance.
 */
async function readPluginManifest(
  rootDir: string,
): Promise<z.infer<typeof pluginManifestSchema> | null> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    );
    return pluginManifestSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Refresh `types/*.d.ts` against this CLI's bundled SDK declarations and
 * report each file that actually changed.
 *
 * `bb plugin build` and `bb plugin dev` call this so an author never
 * typechecks against declarations older than the bb they run. A failure here
 * is reported and swallowed: a read-only or otherwise unwritable `types/`
 * must not fail a build.
 */
async function refreshPluginTypes(
  rootDir: string,
  hasApp: boolean,
): Promise<void> {
  let files: Awaited<ReturnType<typeof syncPluginTypes>>;
  try {
    files = await syncPluginTypes({ rootDir, app: hasApp });
  } catch (error) {
    console.warn(
      `Could not refresh types/ — ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const written = files.filter((file) => file.outcome === "written");
  if (written.length === 0) return;
  console.log(
    `Refreshed SDK declarations: ${written.map((file) => file.path).join(", ")}`,
  );
}

/** The npm tree a generated scaffold declares — what its install must land. */
const scaffoldPackageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

/**
 * Why a scaffold's install cannot be trusted, or null when every declared
 * package resolved.
 *
 * npm's exit code reports only that npm did what its resolved config told it
 * to, so it stays 0 for an install that skipped packages the plugin needs to
 * build — which is exactly the failure this guards (issue #1133).
 */
async function unresolvedScaffoldPackages(
  targetDir: string,
): Promise<string | null> {
  let declared: string[];
  try {
    const manifest = scaffoldPackageSchema.parse(
      JSON.parse(await readFile(join(targetDir, "package.json"), "utf8")),
    );
    declared = [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ];
  } catch {
    return "the generated package.json could not be read back";
  }
  const missing: string[] = [];
  for (const name of declared) {
    if (!(await isPackageInstalled(targetDir, name))) {
      missing.push(name);
    }
  }
  return missing.length === 0
    ? null
    : `${missing.sort().join(", ")} missing from node_modules`;
}

/**
 * Whether `name` resolves for a plugin at `targetDir`, following node's own
 * lookup up the directory chain.
 *
 * Scaffolding inside an npm workspace makes npm install the whole workspace
 * and hoist to its root, so the plugin's own node_modules can be legitimately
 * empty. Checking only the plugin directory would report a healthy install as
 * broken and send the author back to an `npm install` that hoists again.
 */
async function isPackageInstalled(
  targetDir: string,
  name: string,
): Promise<boolean> {
  const segments = name.split("/");
  let dir = targetDir;
  for (;;) {
    try {
      await access(join(dir, "node_modules", ...segments));
      return true;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }
}

/**
 * Install a fresh scaffold's npm tree, reporting whether it is usable.
 *
 * Generated source imports packages `bb plugin build` inlines into dist/ (zod;
 * with --app, the vendored components' deps), and path: installs run server.ts
 * from source, so the tree must exist before the plugin can build or load.
 *
 * `--include=dev` rather than a bare `npm install`: the packaged CLI runs with
 * NODE_ENV=production — bb-app's launcher sets it for every `bb` invocation —
 * which npm reads as `omit=dev`. A command-line flag outranks both that and an
 * inherited `npm_config_omit`, so the install no longer depends on how bb was
 * started. Best-effort overall: authors need npm anyway (design §5.5), so a
 * failure surfaces the manual step rather than failing the scaffold.
 */
async function installScaffoldDependencies(
  targetDir: string,
): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    await promisify(execFile)(
      "npm",
      ["install", "--include=dev", "--no-fund", "--no-audit"],
      { cwd: targetDir },
    );
  } catch {
    console.warn(
      "Could not run npm install — run it in the plugin directory before `bb plugin build`.",
    );
    return false;
  }
  const problem = await unresolvedScaffoldPackages(targetDir);
  if (problem !== null) {
    console.warn(
      `npm install reported success but ${problem} — run \`npm install --include=dev\` in the plugin directory before \`bb plugin build\`.`,
    );
    return false;
  }
  console.log("Installed dependencies (npm install).");
  return true;
}

type PluginSettingDescriptor = z.infer<typeof pluginSettingDescriptorSchema>;
type PluginSettingsResult = z.infer<typeof pluginSettingsResultSchema>;

async function callPlugins(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<unknown> {
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
  return parsed;
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

function formatAbsoluteDate(value: string | number | undefined): string {
  if (value === undefined) return "unknown date";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function dualInterpretationError(source: string): string {
  return (
    `Could not resolve "${source}" as either a catalog plugin or a path on disk. ` +
    "Use a Git repository URL, path:<path>, npm:<package>, or git:<url>[@<ref>] to choose an interpretation explicitly."
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
  | { kind: "catalog"; entry: PluginCatalogSearchResult };

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
  if (/^https?:\/\//iu.test(input)) {
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

  if (!input.includes("@")) {
    const entry = (await searchCatalog(baseUrl, input)).find(
      (candidate) => candidate.entryId === input,
    );
    if (entry !== undefined) return { kind: "catalog", entry };
  }
  if (!(await existsOnDisk(input)))
    throw new Error(dualInterpretationError(input));

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

function sdkErrorMessage(error: unknown): string {
  if (error instanceof BbHttpError) {
    return error.message.replace(/^HTTP \d+: /u, "");
  }
  return error instanceof Error ? error.message : String(error);
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
      const value = secretSettingValueSchema.safeParse(values[key]);
      display = value.success && value.data.set ? "[set]" : "[not set]";
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
    .description("Manage BB plugins")
    // Required (with the program's enablePositionalOptions) for `run` to
    // pass flags after <id> through to the plugin command untouched.
    .enablePositionalOptions();

  plugin
    .command("search <query>")
    .description("Search BB's official plugins (bundled with the app)")
    .option("--json", "Output JSON")
    .action(
      action(async (query: string, opts: JsonOutputOptions) => {
        const results = await searchCatalog(getUrl(), query);
        if (opts.json) {
          outputJson(opts, results);
          return;
        }
        const rows = results.map((result) => [
          result.displayName,
          result.description,
          result.installed
            ? "✓ installed"
            : result.compatible
              ? "compatible"
              : `requires newer bb${result.incompatibleReason ? `: ${result.incompatibleReason}` : ""}`,
        ]);
        console.log(
          renderBorderlessTable(
            {
              head: ["Name", "Description", "Status"],
              colWidths: [28, 54, 48],
              trimTrailingWhitespace: true,
            },
            rows,
          ),
        );
      }),
    );

  plugin
    .command("list")
    .description("List installed plugins and their status")
    .option("--json", "Output JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).plugins.list();
        if (opts.json) {
          outputJson(opts, result);
          return;
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
    .command("source <id>")
    .description("Show an installed plugin's resolved source and history")
    .option("--json", "Output JSON")
    .action(
      action(async (id: string, opts: JsonOutputOptions) => {
        const source = await createCliBbSdk(getUrl()).plugins.getSource({
          pluginId: id,
        });
        if (opts.json) {
          outputJson(opts, source);
          return;
        }
        console.log(`${id}`);
        console.log(`  requested: ${source.requested}`);
        console.log(`  resolved: ${source.resolved}`);
        if (source.registry) console.log(`  registry: ${source.registry}`);
        if (source.integrity) console.log(`  integrity: ${source.integrity}`);
        if (source.engines.bb) {
          console.log(`  engines.bb: ${source.engines.bb}`);
        }
        if (source.engines.bbPluginSdk) {
          console.log(`  engines.bbPluginSdk: ${source.engines.bbPluginSdk}`);
        }
        if (source.installedAt !== undefined) {
          console.log(`  installed: ${formatAbsoluteDate(source.installedAt)}`);
        }
        if (source.history.length === 0) {
          console.log("  history: none");
          return;
        }
        console.log("  history:");
        for (const entry of source.history) {
          console.log(
            `    ${entry.version}  ${formatAbsoluteDate(entry.activatedAt)}`,
          );
        }
      }),
    );

  plugin
    .command("install <source>")
    .description(
      "Install a bundled official plugin by name, Git repository URL, local path, builtin:<name>, git:<url>[@<ref>], or npm:<name>@<version> (managed sources validate engines ranges and build artifacts; bundled plugin ids are reserved)",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Output JSON")
    .action(
      action(
        async (source: string, opts: JsonOutputOptions & { yes?: boolean }) => {
          const intent = await resolveInstallIntent(getUrl(), source);
          let summary =
            intent.kind === "source"
              ? intent.summary
              : `Installing ${intent.entry.displayName}, bundled with BB (${intent.entry.source})`;
          if (intent.kind === "source" && intent.source.startsWith("path:")) {
            const path = intent.source.slice(5);
            // Best effort — a missing/invalid manifest is the server's
            // error to report after confirmation.
            try {
              const raw: unknown = JSON.parse(
                await readFile(join(path, "package.json"), "utf8"),
              );
              const pkg = pluginPackageSummarySchema.parse(raw);
              if (pkg.name !== undefined) {
                summary = `Installing ${pkg.name}@${pkg.version ?? "?"} from ${path}`;
              }
            } catch {
              // fall through to the bare path summary
            }
          }
          if (!opts.json) {
            console.log(summary);
            console.log(
              "Plugins are full-trust code running inside the BB server. " +
                "They can read all local BB data, including other plugins' secrets.",
            );
          }
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
          const plugin =
            intent.kind === "source"
              ? await createCliBbSdk(getUrl()).plugins.install({
                  source: intent.source,
                })
              : await createCliBbSdk(getUrl()).plugins.catalog.install({
                  entryId: intent.entry.entryId,
                });
          const result = { ok: true as const, plugin };
          if (opts.json) {
            outputJson(opts, result);
            return;
          }
          console.log("Installed:");
          printPlugin(plugin);
        },
      ),
    );

  plugin
    .command("outdated")
    .description("Check installed plugins for compatible updates")
    .option("--json", "Output the raw update results as JSON")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const results = await createCliBbSdk(getUrl()).plugins.checkUpdates();
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
    .option("--yes", "Skip confirmation prompts")
    .action(
      action(
        async (
          id: string | undefined,
          opts: {
            all?: boolean;
            yes?: boolean;
          },
        ) => {
          if ((id === undefined) === !opts.all) {
            console.error("Specify exactly one plugin id or --all.");
            process.exit(1);
          }
          const sdk = createCliBbSdk(getUrl());
          const results = await sdk.plugins.checkUpdates(
            id === undefined ? {} : { pluginId: id },
          );
          const sources = new Map<string, string>();
          if (results.some((result) => result.outcome === "update-available")) {
            const list = await sdk.plugins.list();
            for (const entry of list.plugins)
              sources.set(entry.id, entry.sourceDisplay);
          }

          for (const result of results) {
            const source = sources.get(result.id) ?? "unknown source";
            const detail = updateDetail(result);
            const shouldAttempt = result.outcome === "update-available";

            if (!shouldAttempt) {
              if (result.outcome === "pinned") {
                console.log(
                  `${result.id}: skipped — pinned${detail ? ` (${detail})` : ""}; remove and reinstall with a tracking npm range or git branch to receive updates.`,
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
            console.log(
              `${result.id}: ${result.installed.display} → ${target} from ${source}. Plugins are full-trust code.`,
            );
            await confirmPluginAction(
              "Update and activate?",
              "Refusing to update without confirmation — re-run with --yes.",
              opts.yes === true,
            );

            let mutation: PluginApplyUpdateResult;
            try {
              mutation = await sdk.plugins.applyUpdate({
                pluginId: result.id,
              });
            } catch (error) {
              exitWithError({ error: sdkErrorMessage(error) });
            }
            if (mutation.applied) {
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
      "Scaffold a plugin in ./bb-plugin-<name>; accepts @scope/bb-plugin-<name>",
    )
    .option(
      "--app",
      "Also scaffold a frontend entry (app.tsx, built by `bb plugin build`)",
    )
    .action(
      action(async (name: string, opts: { app?: boolean }) => {
        const target = resolveNewPluginTarget(name);
        if (target === null) {
          console.error(
            `Invalid plugin name "${name}" — use name, bb-plugin-name, or @scope/bb-plugin-name.`,
          );
          process.exit(1);
        }
        const { directoryName, packageName } = target;
        const targetDir = resolve(process.cwd(), directoryName);
        await scaffoldPlugin({
          targetDir,
          packageName,
          bbVersion: resolveBbCliVersion(),
          app: opts.app ?? false,
        });
        console.log(`Created ${directoryName}/ (${packageName}).`);
        const installed = await installScaffoldDependencies(targetDir);
        console.log("Next steps:");
        console.log(`  cd ${directoryName}`);
        if (!installed) {
          console.log("  npm install --include=dev");
        }
        console.log("  bb plugin install .");
      }),
    );

  plugin
    .command("types [path]")
    .description(
      "Write this bb's @bb/plugin-sdk declarations into the plugin's types/ directory (default: cwd); the authoritative, readable API surface for editors, tsc, and agents",
    )
    .option("--check", "Report whether types/ is current; write nothing")
    .action(
      action(async (path: string | undefined, opts: { check?: boolean }) => {
        const rootDir = resolve(process.cwd(), path ?? ".");
        const manifest = await readPluginManifest(rootDir);
        if (!manifest) {
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
        const files = await syncPluginTypes({
          rootDir,
          app: hasApp,
          check: opts.check ?? false,
        });
        for (const file of files) {
          console.log(`${file.path} ${file.outcome}`);
        }
        if (opts.check) {
          if (files.some((file) => file.outcome === "stale")) {
            console.error(
              "Declarations are out of date — run `bb plugin types` to refresh them.",
            );
            process.exit(1);
          }
          return;
        }
        console.log(
          "These declarations are the full plugin API — read them for exact signatures.",
        );
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
        // Read the manifest before building: buildPluginServer errors legibly
        // on a missing/invalid bb.server, so a null manifest here is only the
        // unreachable case where that read also fails.
        const manifest = await readPluginManifest(rootDir);
        const hasApp = typeof manifest?.bb?.app === "string";
        // Keep the local declarations tracking the bb doing the build, so a
        // plugin scaffolded against an older SDK never typechecks green
        // against an API this bb no longer has. Gate on bb.server so a
        // directory this command is about to reject is never written to first.
        if (typeof manifest?.bb?.server === "string") {
          await refreshPluginTypes(rootDir, hasApp);
        }
        const toolchain = await cliBuildToolchain();
        const server = await buildPluginServer(rootDir, bbVersion, toolchain);
        const files = [server.jsPath, server.mapPath, server.metaPath];
        if (hasApp) {
          const app = await buildPluginApp(rootDir, bbVersion, toolchain);
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
        const manifest = await readPluginManifest(rootDir);
        if (!manifest) {
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
        // Refresh before the watcher starts, so writing types/ cannot feed
        // the loop its own change event.
        await refreshPluginTypes(rootDir, hasApp);
        // The dev loop drives an *installed* plugin; match this directory
        // against the server's installed rows (realpath tolerates symlinked
        // checkouts).
        const realDir = await realpath(rootDir).catch(() => rootDir);
        const list = await createCliBbSdk(getUrl()).plugins.list();
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
        const loop = createPluginDevLoop({
          pluginId: entry.id,
          hasApp,
          buildApp: async () => {
            await buildPluginApp(
              rootDir,
              resolveBbCliVersion(),
              await cliBuildToolchain(),
            );
          },
          reloadPlugin: async () => {
            const result = pluginMutationResultSchema.parse(
              await callPlugins(
                getUrl(),
                `/reload?id=${encodeURIComponent(entry.id)}`,
                "POST",
              ),
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
        const response = pluginMutationResultSchema.parse(
          await callPlugins(getUrl(), `/reload${query}`, "POST"),
        );
        const result =
          id !== undefined &&
          response.ok &&
          !response.plugins?.some((entry) => entry.id === id)
            ? { ok: false as const, error: `unknown plugin "${id}"` }
            : response;
        if (opts.json) {
          outputJson(opts, result);
          if (!result.ok) process.exit(1);
          return;
        }
        if (!result.ok) exitWithError(result);
        const reloaded =
          id === undefined
            ? (result.plugins ?? [])
            : (result.plugins ?? []).filter((entry) => entry.id === id);
        for (const entry of reloaded) {
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
          const result = pluginMutationResultSchema.parse(
            await callPlugins(
              getUrl(),
              `/${encodeURIComponent(id)}/${name}`,
              "POST",
            ),
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
            const result = pluginSettingsResultSchema.parse(
              await callPlugins(getUrl(), settingsPath, "GET"),
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
            if (value === undefined) {
              console.error("Usage: bb plugin config <id> set <key> <value>");
              process.exit(1);
            }
            // Fetch the schema first so booleans/selects are parsed and
            // validated client-side with a friendly message.
            const current = pluginSettingsResultSchema.parse(
              await callPlugins(getUrl(), settingsPath, "GET"),
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
            parsedValue = parseSettingValue(descriptor, key, value);
          }
          const result = pluginSettingsResultSchema.parse(
            await callPlugins(getUrl(), settingsPath, "PUT", {
              values: { [key]: parsedValue },
            }),
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
          const result = pluginTokenResultSchema.parse(
            await callPlugins(
              getUrl(),
              `/${encodeURIComponent(id)}/token`,
              "POST",
              opts.rotate ? { rotate: true } : {},
            ),
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
          const result = pluginLogsResultSchema.parse(
            await callPlugins(
              getUrl(),
              `/${encodeURIComponent(id)}/logs?tail=${count}`,
              "GET",
            ),
          );
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
        const result = pluginMutationResultSchema.parse(
          await callPlugins(getUrl(), `/${encodeURIComponent(id)}`, "DELETE"),
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
