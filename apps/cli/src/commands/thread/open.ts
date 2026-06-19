import path from "node:path";
import { Command } from "commander";
import type { Environment, ThreadListEntry } from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson } from "../helpers.js";

interface ThreadOpenCommandOptions {
  json?: boolean;
}

interface ThreadOpenMatch {
  environment: Environment;
  thread: ThreadListEntry;
}

interface ThreadOpenResult {
  environmentId: string;
  environmentPath: string;
  inputPath: string;
  projectId: string;
  resolvedPath: string;
  threadId: string;
  url: string;
}

function resolveOpenPath(value: string): string {
  return path.resolve(process.cwd(), value);
}

function pathContains(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function buildThreadUrl(args: {
  baseUrl: string;
  projectId: string;
  threadId: string;
}): string {
  const url = new URL(args.baseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${basePath}/projects/${encodeURIComponent(
    args.projectId,
  )}/threads/${encodeURIComponent(args.threadId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function selectBestThreadMatch(args: {
  matches: ThreadOpenMatch[];
  resolvedPath: string;
}): ThreadOpenMatch | null {
  let bestMatch: ThreadOpenMatch | null = null;
  for (const match of args.matches) {
    if (!match.environment.path) {
      continue;
    }
    if (!pathContains(match.environment.path, args.resolvedPath)) {
      continue;
    }
    if (
      bestMatch === null ||
      match.environment.path.length > (bestMatch.environment.path?.length ?? 0)
    ) {
      bestMatch = match;
    }
  }
  return bestMatch;
}

export function registerOpenCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("open <path>")
    .allowExcessArguments(false)
    .description("Find the BB thread for a workspace path and print its URL")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (inputPath: string, opts: ThreadOpenCommandOptions) => {
        const baseUrl = getUrl();
        const sdk = createCliBbSdk(baseUrl);
        const resolvedPath = resolveOpenPath(inputPath);
        const threads = (await sdk.threads.list()).filter(
          (thread) => thread.archivedAt === null && thread.environmentId !== null,
        );
        const environmentsById = new Map<string, Environment>();
        const matches: ThreadOpenMatch[] = [];

        for (const thread of threads) {
          const environmentId = thread.environmentId;
          if (environmentId === null) {
            continue;
          }
          let environment = environmentsById.get(environmentId);
          if (environment === undefined) {
            environment = await sdk.environments.get({ environmentId });
            environmentsById.set(environmentId, environment);
          }
          matches.push({ environment, thread });
        }

        const match = selectBestThreadMatch({ matches, resolvedPath });
        if (match === null || match.environment.path === null) {
          throw new Error(`No BB thread found for path: ${resolvedPath}`);
        }

        const result: ThreadOpenResult = {
          environmentId: match.environment.id,
          environmentPath: match.environment.path,
          inputPath,
          projectId: match.thread.projectId,
          resolvedPath,
          threadId: match.thread.id,
          url: buildThreadUrl({
            baseUrl,
            projectId: match.thread.projectId,
            threadId: match.thread.id,
          }),
        };

        if (outputJson(opts, result)) return;

        console.log(`Thread: ${result.threadId}`);
        console.log(`Project: ${result.projectId}`);
        console.log(`Workspace: ${result.environmentPath}`);
        console.log(`URL: ${result.url}`);
      }),
    );
}
