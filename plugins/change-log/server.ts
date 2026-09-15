import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { changeLogRpcContract } from "./shared/contract.js";
import { buildChangeLog, type BuildChangeLogResult } from "./server/build.js";
import { CHANGE_LOG_CLI_USAGE, formatChangeLogList } from "./server/cli.js";

const REALTIME_CHANNEL = "change-log";
const PROMPT_HISTORY_LIMIT = "100";

interface ListChangesInput {
  threadId: string;
  beforeAnchorSeq?: number;
  beforeAnchorId?: string;
}

interface CliOptions {
  json: boolean;
  jsonPatches: boolean;
  limit: number;
  patches: boolean;
  pathQuery: string;
  threadId: string;
}

function parseCliOptions(argv: readonly string[]): CliOptions | string {
  const options: CliOptions = {
    json: false,
    jsonPatches: false,
    limit: 50,
    patches: false,
    pathQuery: "",
    threadId: "",
  };
  let positionals = 0;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--json-patches") {
      options.jsonPatches = true;
      continue;
    }
    if (arg === "--patches") {
      options.patches = true;
      continue;
    }
    if (arg === "--path") {
      const value = argv[index + 1];
      if (value === undefined) return "--path needs a value";
      options.pathQuery = value;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = argv[index + 1];
      if (value === undefined) return "--limit needs a value";
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return "--limit must be a positive integer";
      }
      options.limit = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      return `unexpected option "${arg}"`;
    }
    if (positionals > 0) return `unexpected argument "${arg}"`;
    options.threadId = arg;
    positionals += 1;
  }
  if (options.threadId === "") return "a thread id is required";
  return options;
}

function toJsonPayload(
  result: BuildChangeLogResult,
  withPatches: boolean,
): unknown {
  if (withPatches) return result;
  return {
    ...result,
    entries: result.entries.map((entry) => ({ ...entry, patch: null })),
  };
}

export default async function plugin(bb: BbPluginApi) {
  async function loadChangeLog(
    input: ListChangesInput,
  ): Promise<BuildChangeLogResult> {
    const thread = await bb.sdk.threads.get({ threadId: input.threadId });
    const cursor =
      input.beforeAnchorSeq !== undefined && input.beforeAnchorId !== undefined
        ? {
            beforeAnchorSeq: String(input.beforeAnchorSeq),
            beforeAnchorId: input.beforeAnchorId,
          }
        : {};
    const [timeline, prompts] = await Promise.all([
      bb.sdk.threads.timeline({
        threadId: input.threadId,
        includeNestedRows: "true",
        ...cursor,
      }),
      bb.sdk.threads
        .promptHistory({
          threadId: input.threadId,
          limit: PROMPT_HISTORY_LIMIT,
        })
        .catch(() => []),
    ]);
    return buildChangeLog({
      thread: {
        id: thread.id,
        title: thread.title ?? thread.titleFallback ?? "",
        environmentId: thread.environmentId,
      },
      timeline,
      prompts,
    });
  }

  bb.rpc.register(changeLogRpcContract, {
    async listChanges(input) {
      return loadChangeLog(input);
    },
  });

  bb.events.on("experimental_thread.events", ({ thread }) => {
    bb.realtime.publish(REALTIME_CHANNEL, { threadId: thread.id });
  });

  bb.cli.register({
    name: "change-log",
    summary: "Show a thread's file-change history",
    commands: [
      {
        name: "list",
        summary: "List the file changes in a thread, newest first",
        usage:
          "bb change-log list <thread-id> [--path <query>] [--limit <n>] [--patches] [--json]",
      },
    ],
    async run(argv) {
      const [subcommand] = argv;
      if (
        subcommand === undefined ||
        subcommand === "help" ||
        subcommand === "--help"
      ) {
        return { exitCode: 0, stdout: CHANGE_LOG_CLI_USAGE };
      }
      if (subcommand !== "list") {
        return {
          exitCode: 1,
          stderr: `Unknown subcommand "${subcommand}".\n${CHANGE_LOG_CLI_USAGE}`,
        };
      }
      const parsed = parseCliOptions(argv);
      if (typeof parsed === "string") {
        return { exitCode: 1, stderr: `${parsed}\n${CHANGE_LOG_CLI_USAGE}` };
      }
      const result = await loadChangeLog({ threadId: parsed.threadId });
      if (parsed.json) {
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            toJsonPayload(result, parsed.jsonPatches),
            null,
            2,
          ),
        };
      }
      return {
        exitCode: 0,
        stdout: formatChangeLogList(result, {
          limit: parsed.limit,
          pathQuery: parsed.pathQuery,
          withPatches: parsed.patches,
        }),
      };
    },
  });
}
