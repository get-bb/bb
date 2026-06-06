import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  appDataPathSchema,
  applicationIdSchema,
  appSourceNameSchema,
  deriveApplicationIdFromName,
  jsonValueSchema,
} from "@bb/domain";
import type {
  AppDataPath,
  ApplicationId,
  AppSourceName,
  JsonValue,
} from "@bb/domain";
import type {
  AppDataEntry,
  AppDetail,
  AppIcon,
  AppSourceStatus,
  AppSummary,
  CreateAppRequest,
} from "@bb/server-contract";
import type { CurrentAppRuntimeContext } from "@bb/sdk";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";

type ResolveServerUrl = () => string;

interface AppJsonOptions {
  json?: boolean;
}

interface AppNewCommandOptions extends AppJsonOptions {
  id?: string;
  name?: string;
  slug?: string;
}

interface AppDeleteCommandOptions extends AppJsonOptions {
  yes?: boolean;
}

interface AppDataListCommandOptions extends AppJsonOptions {}

interface AppDataWriteCommandOptions {
  file?: string;
  stdin?: boolean;
}

interface AppMessageCommandOptions {
  json: string;
  targetThread: string;
}

interface AppSourceAddCommandOptions extends AppJsonOptions {
  name?: string;
  ref?: string;
}

interface AppSourceSyncCommandOptions extends AppJsonOptions {
  force?: boolean;
  yes?: boolean;
}

interface AppSourceRemoveCommandOptions extends AppJsonOptions {
  yes?: boolean;
}

function parseApplicationId(value: string): ApplicationId {
  const parsed = applicationIdSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    "Invalid applicationId. Expected a lowercase slug like status or review-board.",
  );
}

function parseAppDataPath(value: string): AppDataPath {
  const parsed = appDataPathSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error("Invalid app data path.");
}

function parseAppSourceName(value: string): AppSourceName {
  const parsed = appSourceNameSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    "Invalid app source name. Expected a lowercase slug like my-apps.",
  );
}

function deriveApplicationIdFromNameForCli(name: string): ApplicationId {
  try {
    return deriveApplicationIdFromName(name);
  } catch {
    throw new Error("App name cannot be converted to a valid applicationId.");
  }
}

function resolveNewApplicationId(opts: AppNewCommandOptions): ApplicationId {
  if (
    opts.id !== undefined &&
    opts.slug !== undefined &&
    opts.id !== opts.slug
  ) {
    throw new Error("Use either --id or --slug, not both.");
  }
  const explicitApplicationId = opts.id ?? opts.slug;
  if (explicitApplicationId !== undefined) {
    return parseApplicationId(explicitApplicationId);
  }
  if (opts.name !== undefined) {
    return deriveApplicationIdFromNameForCli(opts.name);
  }
  throw new Error("Provide --id <slug>, --slug <slug>, or --name <name>.");
}

function buildCreateAppRequest(opts: AppNewCommandOptions): CreateAppRequest {
  const applicationId = resolveNewApplicationId(opts);
  const request: CreateAppRequest = { applicationId };
  if (opts.name !== undefined) {
    request.name = opts.name;
  }
  return request;
}

function formatIcon(icon: AppIcon): string {
  return icon.kind === "builtin" ? icon.name : "logo";
}

function formatAppSourceCell(
  app: AppSummary,
  sources: AppSourceStatus[],
): string {
  if (app.source === null) {
    return "-";
  }
  const ownerState = sources
    .find((source) => source.name === app.source?.name)
    ?.apps.find((entry) => entry.applicationId === app.applicationId);
  return ownerState?.status === "modified"
    ? `${app.source.name} (modified)`
    : app.source.name;
}

function printAppsTable(apps: AppSummary[], sources: AppSourceStatus[]): void {
  if (apps.length === 0) {
    console.log("No apps");
    return;
  }
  console.log(
    renderBorderlessTable(
      {
        head: ["Application ID", "Name", "Entry", "Capabilities", "Icon", "Source"],
        colWidths: [32, 24, 24, 24, 18, 24],
        trimTrailingWhitespace: true,
      },
      apps.map((app) => [
        app.applicationId,
        app.name,
        `${app.entry.kind}:${app.entry.path}`,
        app.capabilities.join(",") || "-",
        formatIcon(app.icon),
        formatAppSourceCell(app, sources),
      ]),
    ),
  );
}

function formatAppSourceAppsSummary(status: AppSourceStatus): string {
  if (status.apps.length === 0) {
    return "none";
  }
  const counts = new Map<string, number>();
  for (const app of status.apps) {
    counts.set(app.status, (counts.get(app.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([state, count]) => `${count} ${state}`)
    .join(", ");
}

function printAppSourcesTable(sources: AppSourceStatus[]): void {
  if (sources.length === 0) {
    console.log("No app sources");
    return;
  }
  console.log(
    renderBorderlessTable(
      {
        head: ["Name", "Origin", "Ref", "Commit", "Last Synced", "Apps", "Error"],
        colWidths: [20, 40, 12, 12, 26, 28, 30],
        trimTrailingWhitespace: true,
      },
      sources.map((source) => [
        source.name,
        source.origin,
        source.ref ?? "-",
        source.lastCommitSha?.slice(0, 8) ?? "-",
        source.lastSyncedAt ?? "never",
        formatAppSourceAppsSummary(source),
        source.lastError ?? "-",
      ]),
    ),
  );
}

function printAppSourceStatus(status: AppSourceStatus): void {
  console.log(`Source ${status.name}`);
  console.log(`  Origin:      ${status.origin}`);
  console.log(`  Ref:         ${status.ref ?? "(default branch)"}`);
  console.log(`  Commit:      ${status.lastCommitSha ?? "-"}`);
  console.log(`  Last synced: ${status.lastSyncedAt ?? "never"}`);
  console.log(`  Error:       ${status.lastError ?? "-"}`);
  if (status.apps.length === 0) {
    console.log("  Apps:        none");
    return;
  }
  console.log("  Apps:");
  for (const app of status.apps) {
    const detail = app.error === null ? "" : `  ${app.error}`;
    console.log(`    ${app.applicationId.padEnd(28)}${app.status}${detail}`);
  }
}

function printAppDetail(app: AppDetail): void {
  console.log(`Application ID: ${app.applicationId}`);
  console.log(`  Name:          ${app.name}`);
  console.log(`  Entry:         ${app.entry.kind}:${app.entry.path}`);
  console.log(`  Capabilities:  ${app.capabilities.join(",") || "-"}`);
  console.log(`  Icon:          ${formatIcon(app.icon)}`);
  console.log(`  App root:      ${app.appRootPath}`);
  console.log(`  App data path: ${app.appDataPath}`);
}

function printDataEntries(entries: AppDataEntry[]): void {
  if (entries.length === 0) {
    console.log("No app data");
    return;
  }
  console.log(
    renderBorderlessTable(
      {
        head: ["Path", "Size", "Version"],
        colWidths: [36, 10, 64],
        trimTrailingWhitespace: true,
      },
      entries.map((entry) => [
        entry.path,
        String(entry.sizeBytes),
        entry.version,
      ]),
    ),
  );
}

function parseJsonValueInput(value: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(value));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readWriteValue(
  opts: AppDataWriteCommandOptions,
): Promise<JsonValue> {
  if (opts.file && opts.stdin) {
    throw new Error("Use either --file or --stdin, not both.");
  }
  if (!opts.file && !opts.stdin) {
    throw new Error("Provide --file <localPath> or --stdin.");
  }
  const content =
    opts.file !== undefined
      ? await readFile(opts.file, "utf8")
      : await readStdin();
  return parseJsonValueInput(content);
}

function readCurrentAppRuntimeContext(): CurrentAppRuntimeContext {
  const applicationId = process.env.BB_APP_ID;
  const appRootPath = process.env.BB_APP_ROOT;
  const appDataPath = process.env.BB_APP_DATA_PATH;
  const appsRootPath = process.env.BB_APPS_ROOT;
  if (!applicationId || !appRootPath || !appDataPath || !appsRootPath) {
    throw new Error("current_app_unavailable");
  }
  return {
    applicationId: parseApplicationId(applicationId),
    appRootPath,
    appDataPath,
    appsRootPath,
  };
}

export function registerAppCommands(
  program: Command,
  getUrl: ResolveServerUrl,
): void {
  const app = program.command("app").description("Manage global apps");

  app
    .command("list")
    .description("List global apps")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppJsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const apps = await sdk.apps.list();
        if (outputJson(opts, apps)) return;
        // Source states (for the modified marker) only matter when at least
        // one listed app is source-managed.
        const sources = apps.some((app) => app.source !== null)
          ? await sdk.apps.sources.list()
          : [];
        printAppsTable(apps, sources);
      }),
    );

  app
    .command("new")
    .description("Create a global app")
    .option("--id <slug>", "Application slug id")
    .option("--slug <slug>", "Alias for --id")
    .option(
      "--name <name>",
      "Human display name; derives slug when id is omitted",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppNewCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const created = await sdk.apps.create(buildCreateAppRequest(opts));
        if (outputJson(opts, created)) return;
        printAppDetail(created);
      }),
    );

  app
    .command("current")
    .description("Show current app runtime context")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppJsonOptions) => {
        const runtimeContext = readCurrentAppRuntimeContext();
        const sdk = createCliBbSdk(getUrl(), { context: runtimeContext });
        const current = await sdk.apps.current();
        if (outputJson(opts, current)) return;
        console.log(`Application ID: ${current.applicationId}`);
        console.log(`  App root:      ${current.appRootPath}`);
        console.log(`  App data path: ${current.appDataPath}`);
        console.log(`  Apps root:     ${current.appsRootPath}`);
      }),
    );

  app
    .command("show <applicationId>")
    .description("Show a global app")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (rawApplicationId: string, opts: AppJsonOptions) => {
        const applicationId = parseApplicationId(rawApplicationId);
        const sdk = createCliBbSdk(getUrl());
        const detail = await sdk.apps.get({ applicationId });
        if (outputJson(opts, detail)) return;
        printAppDetail(detail);
      }),
    );

  app
    .command("delete <applicationId>")
    .description("Delete a global app")
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (rawApplicationId: string, opts: AppDeleteCommandOptions) => {
          const applicationId = parseApplicationId(rawApplicationId);
          const sdk = createCliBbSdk(getUrl());
          const appDetail = await sdk.apps.get({ applicationId });
          if (!opts.yes) {
            const confirmed = await confirmDestructiveAction(
              `Delete app "${appDetail.name}" (${applicationId})? This cannot be undone.`,
            );
            if (!confirmed) {
              console.log(`App ${applicationId} deletion cancelled`);
              return;
            }
          }
          await sdk.apps.delete({ applicationId });
          const payload = { ok: true, applicationId };
          if (outputJson(opts, payload)) return;
          console.log(`App ${applicationId} deleted`);
        },
      ),
    );

  const source = app
    .command("source")
    .description(
      "Manage app sources: git repos of apps that install and update as a unit. " +
        "Only add repos you trust — their apps serve browser code and inject agent skills.",
    );

  source
    .command("add <origin>")
    .description("Register a git repo (or local path) of apps and install them")
    .option("--name <slug>", "Source name; derived from the origin when omitted")
    .option("--ref <ref>", "Pin to a branch, tag, or commit (default: remote default branch)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (origin: string, opts: AppSourceAddCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const status = await sdk.apps.sources.add({
          origin,
          ...(opts.name === undefined
            ? {}
            : { name: parseAppSourceName(opts.name) }),
          ...(opts.ref === undefined ? {} : { ref: opts.ref }),
        });
        if (outputJson(opts, status)) return;
        printAppSourceStatus(status);
      }),
    );

  source
    .command("list")
    .description("List app sources and their sync state")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppJsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const sources = await sdk.apps.sources.list();
        if (outputJson(opts, sources)) return;
        printAppSourcesTable(sources);
      }),
    );

  source
    .command("sync [name]")
    .description("Fetch a source (or all sources) and update its apps")
    .option("--force", "Discard local edits to diverged apps")
    .option("--yes", "Skip the --force confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          rawName: string | undefined,
          opts: AppSourceSyncCommandOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const force = opts.force === true;
          if (force && !opts.yes) {
            const confirmed = await confirmDestructiveAction(
              "Force sync discards local edits to diverged apps. Continue?",
            );
            if (!confirmed) {
              console.log("Sync cancelled");
              return;
            }
          }
          const names =
            rawName !== undefined
              ? [parseAppSourceName(rawName)]
              : (await sdk.apps.sources.list()).map((status) => status.name);
          if (names.length === 0) {
            console.log("No app sources");
            return;
          }
          const statuses = [];
          for (const name of names) {
            statuses.push(await sdk.apps.sources.sync({ name, force }));
          }
          if (outputJson(opts, statuses)) return;
          for (const status of statuses) {
            printAppSourceStatus(status);
          }
        },
      ),
    );

  source
    .command("detach <applicationId>")
    .description("Detach a managed app from its source; it becomes a local app")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (rawApplicationId: string, opts: AppJsonOptions) => {
        const applicationId = parseApplicationId(rawApplicationId);
        const sdk = createCliBbSdk(getUrl());
        await sdk.apps.detach({ applicationId });
        const payload = { ok: true, applicationId };
        if (outputJson(opts, payload)) return;
        console.log(`App ${applicationId} detached; it is now locally managed`);
      }),
    );

  source
    .command("remove <name>")
    .description(
      "Remove a source and its managed apps (app data is kept and reattaches on reinstall)",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (rawName: string, opts: AppSourceRemoveCommandOptions) => {
        const name = parseAppSourceName(rawName);
        const sdk = createCliBbSdk(getUrl());
        if (!opts.yes) {
          const confirmed = await confirmDestructiveAction(
            `Remove app source "${name}" and its managed apps? App data is kept.`,
          );
          if (!confirmed) {
            console.log(`App source ${name} removal cancelled`);
            return;
          }
        }
        await sdk.apps.sources.remove({ name });
        const payload = { ok: true, name };
        if (outputJson(opts, payload)) return;
        console.log(`App source ${name} removed`);
      }),
    );

  const data = app.command("data").description("Manage global app data");

  data
    .command("list <applicationId> [path]")
    .description("List app data entries")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          rawApplicationId: string,
          prefix: string | undefined,
          opts: AppDataListCommandOptions,
        ) => {
          const applicationId = parseApplicationId(rawApplicationId);
          const dataPrefix = prefix === undefined ? "" : parseAppDataPath(prefix);
          const sdk = createCliBbSdk(getUrl());
          const response = await sdk.apps.data.list({
            applicationId,
            prefix: dataPrefix,
          });
          if (outputJson(opts, response.entries)) return;
          printDataEntries(response.entries);
        },
      ),
    );

  data
    .command("read <applicationId> <path>")
    .description("Read an app data JSON value")
    .action(
      action(async (rawApplicationId: string, dataPath: string) => {
        const applicationId = parseApplicationId(rawApplicationId);
        const path = parseAppDataPath(dataPath);
        const sdk = createCliBbSdk(getUrl());
        const response = await sdk.apps.data.read({
          applicationId,
          path,
        });
        if (!response) {
          throw new Error(`App data path not found: ${path}`);
        }
        console.log(JSON.stringify(response.value, null, 2));
      }),
    );

  data
    .command("write <applicationId> <path>")
    .description("Write an app data JSON value")
    .option("--file <localPath>", "Read JSON value from a local file")
    .option("--stdin", "Read JSON value from stdin")
    .action(
      action(
        async (
          rawApplicationId: string,
          dataPath: string,
          opts: AppDataWriteCommandOptions,
        ) => {
          const applicationId = parseApplicationId(rawApplicationId);
          const path = parseAppDataPath(dataPath);
          const value = await readWriteValue(opts);
          const sdk = createCliBbSdk(getUrl());
          await sdk.apps.data.write({
            applicationId,
            path,
            value,
          });
          console.log(`Wrote ${dataPath}`);
        },
      ),
    );

  data
    .command("delete <applicationId> <path>")
    .description("Delete an app data value")
    .action(
      action(async (rawApplicationId: string, dataPath: string) => {
        const applicationId = parseApplicationId(rawApplicationId);
        const path = parseAppDataPath(dataPath);
        const sdk = createCliBbSdk(getUrl());
        await sdk.apps.data.delete({ applicationId, path });
        console.log(`Deleted ${dataPath}`);
      }),
    );

  app
    .command("message <applicationId>")
    .description("Send an app message to a target thread")
    .requiredOption("--target-thread <threadId>", "Target thread")
    .requiredOption("--json <payload>", "JSON payload to send")
    .action(
      action(
        async (rawApplicationId: string, opts: AppMessageCommandOptions) => {
          const applicationId = parseApplicationId(rawApplicationId);
          const payload = parseJsonValueInput(opts.json);
          const sdk = createCliBbSdk(getUrl());
          await sdk.apps.message({
            applicationId,
            payload,
            targetThreadId: opts.targetThread,
          });
          console.log(`Message sent to ${opts.targetThread}`);
        },
      ),
    );
}
