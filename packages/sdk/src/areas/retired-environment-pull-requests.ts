import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { BbHttpError } from "../response.js";
import type { PluginsArea } from "./plugins.js";

const GITHUB_PR_STATUS_PLUGIN_ID = "bb--github-pr-status";

type EnvironmentArgs = { environmentId: string; signal?: AbortSignal };
type MergeMethod = "merge" | "squash" | "rebase";

const pullRequestRowsSchema = z.record(z.string(), jsonValueSchema);
const actionResultSchema = z.object({ message: z.string().min(1) });
const refusalBodySchema = z.object({
  error: z.object({ message: z.string().min(1) }),
});

function httpError(status: number, code: string, message: string): BbHttpError {
  return new BbHttpError({ body: { code, message }, code, message, status });
}

function retiredActionError(error: unknown): never {
  if (!(error instanceof BbHttpError)) throw error;
  if (error.code === "not_found") {
    throw httpError(404, "environment_not_found", "Environment not found");
  }
  if (error.code === "conflict") {
    const body = refusalBodySchema.safeParse(error.body);
    throw httpError(
      409,
      "pull_request_action_failed",
      body.success ? body.data.error.message : error.message,
    );
  }
  throw error;
}

export function createRetiredEnvironmentPullRequests(
  callRpc: PluginsArea["callRpc"],
) {
  async function act(
    method: "markReady" | "markDraft" | "merge",
    input: { environmentId: string; method?: MergeMethod },
  ): Promise<string> {
    const result = await callRpc({
      pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
      method,
      input,
      outputSchema: actionResultSchema,
    }).catch(retiredActionError);
    return result.message;
  }

  return {
    async pullRequest(args: EnvironmentArgs): Promise<JsonValue> {
      const rows = await callRpc({
        pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
        method: "pullRequests",
        input: { keys: [args.environmentId] },
        outputSchema: pullRequestRowsSchema,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });
      return (
        rows[args.environmentId] ?? {
          outcome: "unavailable",
          message: "The GitHub PR Status plugin returned no pull request",
        }
      );
    },
    async markPullRequestReady(args: { environmentId: string }) {
      return {
        ok: true,
        action: "pull_request_ready",
        message: await act("markReady", { environmentId: args.environmentId }),
      } as const;
    },
    async markPullRequestDraft(args: { environmentId: string }) {
      return {
        ok: true,
        action: "pull_request_draft",
        message: await act("markDraft", { environmentId: args.environmentId }),
      } as const;
    },
    async mergePullRequest(args: {
      environmentId: string;
      method: MergeMethod;
    }) {
      return {
        ok: true,
        action: "pull_request_merge",
        method: args.method,
        message: await act("merge", {
          environmentId: args.environmentId,
          method: args.method,
        }),
      } as const;
    },
  };
}
