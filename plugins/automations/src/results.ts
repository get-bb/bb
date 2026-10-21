import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  getAutomation,
  latestAutomationRunForThread,
  parseAutomationExecution,
  type Db,
} from "./data.js";
import {
  publicationHostContract,
  publicationInspectionSchema,
  publicationSnapshotSchema,
} from "./publication-contract.js";

const threadInput = z.object({ threadId: z.string().min(1) }).strict();
export const automationResultRpcContract = defineRpcContract({
  automation_result: {
    input: threadInput,
    output: z
      .object({
        result: z
          .object({
            automationId: z.string(),
            name: z.string(),
            inspection: publicationInspectionSchema,
          })
          .nullable(),
      })
      .strict(),
  },
  automation_publish: {
    input: threadInput
      .extend({
        snapshot: publicationSnapshotSchema,
        title: z.string().trim().min(1).max(256),
        body: z.string().max(60_000),
      })
      .strict(),
    output: z.object({ url: z.string().url() }).strict(),
  },
});

export function createAutomationResults(
  bb: Pick<BbPluginApi, "sdk" | "hosts">,
  db: Db,
) {
  const publishing = new Set<string>();
  async function resultContext(threadId: string) {
    const run = latestAutomationRunForThread(db, threadId);
    if (!run || run.status !== "succeeded") return null;
    const automation = getAutomation(db, run.automationId);
    if (!automation) return null;
    const execution = parseAutomationExecution(automation.execution);
    if (execution.mode !== "agent" || execution.networkAccess !== false)
      return null;
    const thread = await bb.sdk.threads.get({ threadId });
    if (
      thread.status !== "idle" ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.projectId !== automation.projectId ||
      !thread.environmentId
    )
      return null;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (
      environment.projectId !== automation.projectId ||
      environment.status !== "ready" ||
      !environment.path
    )
      return null;
    return { automation, environment, path: environment.path };
  }
  return {
    async read(input: z.infer<typeof threadInput>) {
      const context = await resultContext(input.threadId);
      if (!context) return { result: null };
      const host = bb.hosts.experimental_client({
        contract: publicationHostContract,
      });
      const inspection = await host.call(
        "inspectPublication",
        {
          path: context.path,
          baseBranch:
            context.environment.baseBranch ?? context.environment.defaultBranch,
        },
        { hostId: context.environment.hostId },
      );
      return {
        result: {
          automationId: context.automation.id,
          name: context.automation.name,
          inspection,
        },
      };
    },
    async publish(
      input: z.infer<
        typeof automationResultRpcContract.automation_publish.input
      >,
    ) {
      if (publishing.has(input.threadId))
        throw new Error("This result is already being published");
      publishing.add(input.threadId);
      try {
        const context = await resultContext(input.threadId);
        if (!context)
          throw new Error("This result is not ready for publication");
        const host = bb.hosts.experimental_client({
          contract: publicationHostContract,
        });
        return await host.call(
          "publish",
          {
            path: context.path,
            snapshot: input.snapshot,
            title: input.title,
            body: input.body,
          },
          { hostId: context.environment.hostId, timeoutMs: 240_000 },
        );
      } finally {
        publishing.delete(input.threadId);
      }
    },
  };
}

export type AutomationResults = ReturnType<typeof createAutomationResults>;
