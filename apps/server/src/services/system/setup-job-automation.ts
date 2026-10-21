import { z } from "zod";
import { setupJobTimezoneSchema, type SetupJobArm } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { PluginService } from "../plugins/plugin-service.js";

export const SETUP_JOB_HOLDOUT_KEY = "app_setup_recurring_job";

const LOCAL_REVIEW_INSTRUCTIONS = `This is an opted-in weeknight job with network access disabled. Keep changes local. Do not push, open a pull request, publish, deploy, or send work to another agent. Use the repository's documented local test commands and preserve unrelated changes. Do not modify production accounts or data. If dependencies or services are unavailable without network access, explain that in the result. Do not disable the sandbox. Create a task branch before editing. Commit only your completed changes on that local branch, then leave a concise result with the branch, changed files and test outcomes. bb provides a separate publication action after the run; do not publish from this session.`;

export const setupJobDefinitions: Record<
  SetupJobArm,
  { title: string; name: string; prompt: string }
> = {
  a: {
    title: "Each weeknight, keep going on unfinished work",
    name: "Keep going on unfinished work",
    prompt: `Read the inherited conversation and continue only a concrete unfinished task that the person already requested. If it was completed or cancelled, do nothing. This is a separate restricted session in the same workspace: never send work back to the source thread or another agent. Continue the local work, run relevant tests, and report the result here. Never start another recurring job.
${LOCAL_REVIEW_INSTRUCTIONS}`,
  },
  b: {
    title: "Each weeknight, fix what's failing on main",
    name: "Fix what's failing on main",
    prompt: `Work in this isolated local branch. Check the repository's main branch (or documented default branch) and run its test suite. bb supplies any available CI evidence below before the run. Use that evidence alongside local tests; do not access GitHub or attempt to sign in.
Only fix failures that you can reproduce or verify from CI evidence. Keep the repairs together on this local branch, run the relevant tests again, and leave the diff and test results ready for review. If nothing is failing, do not create changes. Never push or create a remote PR during this scheduled run.
${LOCAL_REVIEW_INSTRUCTIONS}`,
  },
};

type SetupJobPlugins = Pick<
  PluginService,
  "list" | "getRpcHandler" | "invokeRpcHandler"
>;

interface SetupJobExecution {
  projectId: string;
  hostId: string;
  providerId: string;
  model: string;
  reasoningLevel: string;
}

const createdAutomationSchema = z.object({ id: z.string().min(1) });

export async function createSetupJobAutomation(
  plugins: SetupJobPlugins,
  args: {
    accepted: boolean;
    suggestionAnalyticsId: string;
    arm: SetupJobArm;
    timezone: string;
    execution: SetupJobExecution;
  },
): Promise<string | null> {
  if (!args.accepted) return null;
  const timezone = setupJobTimezoneSchema.parse(args.timezone);
  const plugin = plugins
    .list()
    .find((entry) => entry.source === "builtin:automations");
  if (plugin === undefined) {
    throw new ApiError(
      409,
      "setup_job_unavailable",
      "Turn on Automations before starting this job.",
    );
  }
  const handler = plugins.getRpcHandler(plugin.id, "automations_create");
  if (handler.outcome !== "found") {
    throw new ApiError(
      409,
      "setup_job_unavailable",
      "Automations is not ready. Try again or continue without the job.",
    );
  }
  const definition = setupJobDefinitions[args.arm];
  const result = await plugins.invokeRpcHandler(
    plugin.id,
    "automations_create",
    handler.value,
    {
      projectId: args.execution.projectId,
      idempotencyKey: `setup-job:${args.suggestionAnalyticsId}`,
      name: definition.name,
      enabled: true,
      origin: "app",
      trigger: { triggerType: "schedule", cron: "0 22 * * 1-5", timezone },
      execution: {
        mode: "agent",
        prompt: `${definition.prompt}\nThe schedule uses time zone ${timezone}. Today means the calendar day in that time zone. This project is ${args.execution.projectId}.`,
        providerId: args.execution.providerId,
        model: args.execution.model,
        reasoningLevel: args.execution.reasoningLevel,
        permissionMode: "accept-edits",
        networkAccess: false,
        preparation:
          args.arm === "a"
            ? { kind: "unfinished-thread", timezone }
            : { kind: "main-branch-checks" },
        environment:
          args.arm === "a"
            ? { type: "project-default" }
            : {
                type: "host",
                hostId: args.execution.hostId,
                workspace: {
                  type: "managed-worktree",
                  baseBranch: { kind: "default" },
                },
              },
      },
    },
    { kind: "client" },
  );
  if (!result.ok) {
    throw new ApiError(409, "setup_job_create_failed", result.error.message);
  }
  return createdAutomationSchema.parse(result.result).id;
}
