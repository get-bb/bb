import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import type {
  ThreadStatusDataGetResponse,
  ThreadStatusDataListResponse,
  ThreadStatusDataPutResponse,
} from "@bb/server-contract";
import { action } from "../action.js";
import { type Client, createClient, unwrap } from "../client.js";
import { outputJson } from "./helpers.js";

interface StatusStateOutputOptions {
  json?: boolean;
}

interface StatusStateSetOptions extends StatusStateOutputOptions {
  createOnly?: boolean;
  ifMatch?: string;
  mustExist?: boolean;
}

interface StatusStateDeleteOptions extends StatusStateOutputOptions {
  ifMatch?: string;
  mustExist?: boolean;
}

interface ListStatusStateArgs {
  client: Client;
  threadId: string;
}

interface GetStatusStateArgs {
  client: Client;
  key: string;
  threadId: string;
}

interface SetStatusStateArgs {
  client: Client;
  headers: Record<string, string>;
  key: string;
  threadId: string;
  value: JsonValue;
}

interface DeleteStatusStateArgs {
  client: Client;
  headers: Record<string, string>;
  key: string;
  threadId: string;
}

function parseJsonValueText(text: string): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(text));
  } catch {
    throw new Error("Value must be valid JSON.");
  }
}

async function parseJsonValueArg(valueOrFile: string): Promise<JsonValue> {
  if (valueOrFile.startsWith("@")) {
    const filePath = valueOrFile.slice(1);
    if (filePath.length === 0) {
      throw new Error("@file value must include a file path.");
    }
    return parseJsonValueText(await readFile(filePath, "utf8"));
  }
  return parseJsonValueText(valueOrFile);
}

function buildSetHeaders(options: StatusStateSetOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const preconditionCount = [
    options.ifMatch !== undefined,
    options.createOnly === true,
    options.mustExist === true,
  ].filter(Boolean).length;
  if (preconditionCount > 1) {
    throw new Error("Use only one of --if-match, --create-only, or --must-exist.");
  }
  if (options.ifMatch !== undefined) {
    headers["if-match"] = options.ifMatch;
  }
  if (options.createOnly === true) {
    headers["if-none-match"] = "*";
  }
  if (options.mustExist === true) {
    headers["if-match"] = "*";
  }
  return headers;
}

function buildDeleteHeaders(
  options: StatusStateDeleteOptions,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.ifMatch !== undefined && options.mustExist === true) {
    throw new Error("Use only one of --if-match or --must-exist.");
  }
  if (options.ifMatch !== undefined) {
    headers["if-match"] = options.ifMatch;
  }
  if (options.mustExist === true) {
    headers["if-match"] = "*";
  }
  return headers;
}

async function listStatusState(
  args: ListStatusStateArgs,
): Promise<ThreadStatusDataListResponse> {
  return unwrap<ThreadStatusDataListResponse>(
    args.client.api.v1.threads[":id"]["status-data"].$get({
      param: { id: args.threadId },
    }),
  );
}

async function getStatusState(
  args: GetStatusStateArgs,
): Promise<ThreadStatusDataGetResponse> {
  return unwrap<ThreadStatusDataGetResponse>(
    args.client.api.v1.threads[":id"]["status-data"][":key"].$get({
      param: { id: args.threadId, key: args.key },
    }),
  );
}

async function setStatusState(
  args: SetStatusStateArgs,
): Promise<ThreadStatusDataPutResponse> {
  return unwrap<ThreadStatusDataPutResponse>(
    args.client.api.v1.threads[":id"]["status-data"][":key"].$put(
      {
        param: { id: args.threadId, key: args.key },
        json: { value: args.value },
      },
      { headers: args.headers },
    ),
  );
}

async function deleteStatusState(
  args: DeleteStatusStateArgs,
): Promise<{ ok: true }> {
  return unwrap<{ ok: true }>(
    args.client.api.v1.threads[":id"]["status-data"][":key"].$delete(
      {
        param: { id: args.threadId, key: args.key },
      },
      { headers: args.headers },
    ),
  );
}

export function registerStatusStateCommand(
  program: Command,
  getUrl: () => string,
): void {
  const statusState = program
    .command("status-state")
    .description("Read and write persistent reactive STATUS state");

  statusState
    .command("list <threadId>")
    .description("List all STATUS state keys and values")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, options: StatusStateOutputOptions) => {
        const response = await listStatusState({
          client: createClient(getUrl()),
          threadId,
        });
        if (outputJson(options, response)) return;
        console.log(JSON.stringify(response.values, null, 2));
      }),
    );

  statusState
    .command("get <threadId> <key>")
    .description("Read one STATUS state JSON value")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          key: string,
          options: StatusStateOutputOptions,
        ) => {
          const response = await getStatusState({
            client: createClient(getUrl()),
            threadId,
            key,
          });
          if (outputJson(options, response)) return;
          console.log(JSON.stringify(response.value, null, 2));
        },
      ),
    );

  statusState
    .command("set <threadId> <key> <valueOrFile>")
    .description("Write one STATUS state JSON value")
    .option("--json", "Print machine-readable JSON output")
    .option("--if-match <version>", "Only write when the current version matches")
    .option("--create-only", "Only create the key when it does not already exist")
    .option("--must-exist", "Only write when the key already exists")
    .action(
      action(
        async (
          threadId: string,
          key: string,
          valueOrFile: string,
          options: StatusStateSetOptions,
        ) => {
          const response = await setStatusState({
            client: createClient(getUrl()),
            threadId,
            key,
            value: await parseJsonValueArg(valueOrFile),
            headers: buildSetHeaders(options),
          });
          if (outputJson(options, response)) return;
          console.log(`Wrote ${response.key} (${response.version})`);
        },
      ),
    );

  statusState
    .command("delete <threadId> <key>")
    .description("Delete one STATUS state JSON value")
    .option("--json", "Print machine-readable JSON output")
    .option("--if-match <version>", "Only delete when the current version matches")
    .option("--must-exist", "Only delete when the key already exists")
    .action(
      action(
        async (
          threadId: string,
          key: string,
          options: StatusStateDeleteOptions,
        ) => {
          const response = await deleteStatusState({
            client: createClient(getUrl()),
            threadId,
            key,
            headers: buildDeleteHeaders(options),
          });
          if (outputJson(options, response)) return;
          console.log(`Deleted ${key}`);
        },
      ),
    );
}
