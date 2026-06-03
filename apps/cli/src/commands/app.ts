import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { applicationIdSchema, jsonValueSchema } from "@bb/domain";
import type { ApplicationId, JsonValue } from "@bb/domain";
import type {
  AppDataEntry,
  AppDataListResponse,
  AppDetail,
  AppIcon,
  AppSummary,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createClient, unwrap } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import {
  confirmDestructiveAction,
  outputJson,
} from "./helpers.js";

type ResolveServerUrl = () => string;

interface AppJsonOptions {
  json?: boolean;
}

interface AppNewCommandOptions extends AppJsonOptions {
  name: string;
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

interface CurrentAppRuntimeContext {
  applicationId: ApplicationId;
  appRootPath: string;
  appDataPath: string;
  appsRootPath: string;
}

function parseApplicationId(value: string): ApplicationId {
  const parsed = applicationIdSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error("Invalid applicationId. Expected an app_-prefixed id.");
}

function encodePathSegments(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function appDataUrl(
  baseUrl: string,
  applicationId: ApplicationId,
  dataPath: string,
): string {
  return `${baseUrl.replace(/\/$/u, "")}/api/v1/apps/${encodeURIComponent(
    applicationId,
  )}/data/${encodePathSegments(dataPath)}`;
}

function formatIcon(icon: AppIcon): string {
  return icon.kind === "builtin" ? icon.name : "logo";
}

function printAppsTable(apps: AppSummary[]): void {
  if (apps.length === 0) {
    console.log("No apps");
    return;
  }
  console.log(
    renderBorderlessTable(
      {
        head: ["Application ID", "Name", "Entry", "Capabilities", "Icon"],
        colWidths: [32, 24, 24, 24, 18],
        trimTrailingWhitespace: true,
      },
      apps.map((app) => [
        app.applicationId,
        app.name,
        `${app.entry.kind}:${app.entry.path}`,
        app.capabilities.join(",") || "-",
        formatIcon(app.icon),
      ]),
    ),
  );
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

async function readWriteValue(opts: AppDataWriteCommandOptions): Promise<JsonValue> {
  if (opts.file && opts.stdin) {
    throw new Error("Use either --file or --stdin, not both.");
  }
  if (!opts.file && !opts.stdin) {
    throw new Error("Provide --file <localPath> or --stdin.");
  }
  const content =
    opts.file !== undefined ? await readFile(opts.file, "utf8") : await readStdin();
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
        const client = createClient(getUrl());
        const apps = await unwrap<AppSummary[]>(client.api.v1.apps.$get());
        if (outputJson(opts, apps)) return;
        printAppsTable(apps);
      }),
    );

  app
    .command("new")
    .description("Create a global app")
    .requiredOption("--name <name>", "Human display name")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: AppNewCommandOptions) => {
        const client = createClient(getUrl());
        const created = await unwrap<AppDetail>(
          client.api.v1.apps.$post({
            json: { name: opts.name },
          }),
        );
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
        const current = readCurrentAppRuntimeContext();
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
        const client = createClient(getUrl());
        const detail = await unwrap<AppDetail>(
          client.api.v1.apps[":applicationId"].$get({
            param: { applicationId },
          }),
        );
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
        async (
          rawApplicationId: string,
          opts: AppDeleteCommandOptions,
        ) => {
          const applicationId = parseApplicationId(rawApplicationId);
          const client = createClient(getUrl());
          const appDetail = await unwrap<AppDetail>(
            client.api.v1.apps[":applicationId"].$get({
              param: { applicationId },
            }),
          );
          if (!opts.yes) {
            const confirmed = await confirmDestructiveAction(
              `Delete app "${appDetail.name}" (${applicationId})? This cannot be undone.`,
            );
            if (!confirmed) {
              console.log(`App ${applicationId} deletion cancelled`);
              return;
            }
          }
          await unwrap<{ ok: true }>(
            client.api.v1.apps[":applicationId"].$delete({
              param: { applicationId },
            }),
          );
          const payload = { ok: true, applicationId };
          if (outputJson(opts, payload)) return;
          console.log(`App ${applicationId} deleted`);
        },
      ),
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
          const client = createClient(getUrl());
          const response = await unwrap<AppDataListResponse>(
            client.api.v1.apps[":applicationId"].data.$get({
              param: { applicationId },
              query: prefix ? { prefix } : {},
            }),
          );
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
        const response = await unwrap<AppDataEntry>(
          fetch(appDataUrl(getUrl(), applicationId, dataPath), {
            method: "GET",
            headers: { Accept: "application/json" },
          }),
        );
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
          const value = await readWriteValue(opts);
          await unwrap<AppDataEntry>(
            fetch(appDataUrl(getUrl(), applicationId, dataPath), {
              method: "PUT",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ value }),
            }),
          );
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
        await unwrap<{ ok: true }>(
          fetch(appDataUrl(getUrl(), applicationId, dataPath), {
            method: "DELETE",
            headers: { Accept: "application/json" },
          }),
        );
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
        async (
          rawApplicationId: string,
          opts: AppMessageCommandOptions,
        ) => {
          const applicationId = parseApplicationId(rawApplicationId);
          const payload = parseJsonValueInput(opts.json);
          const client = createClient(getUrl());
          await unwrap(
            client.api.v1.apps[":applicationId"].message.$post({
              param: { applicationId },
              json: {
                payload,
                targetThreadId: opts.targetThread,
              },
            }),
          );
          console.log(`Message sent to ${opts.targetThread}`);
        },
      ),
    );
}
