import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { listAutomationRuns, type AutomationRow, type Db } from "./data.js";

type ThreadsSdk = BbPluginApi["sdk"]["threads"];
export type ProviderRetryReadApi = {
  sdk: {
    threads: {
      queue: { list(args: { threadId: string }): Promise<unknown> };
      events: {
        list(
          args: Parameters<ThreadsSdk["events"]["list"]>[0],
        ): Promise<unknown>;
      };
    };
  };
};

const queuedRowsSchema = z.array(
  z.object({ payload: z.object({ kind: z.string() }) }).passthrough(),
);
const latestTurnRequestSchema = z.array(
  z
    .object({
      data: z.object({ retryOfRequestId: z.string().optional() }).passthrough(),
    })
    .passthrough(),
);

const threadGoneErrorSchema = z
  .object({ status: z.literal(404) })
  .passthrough();

async function providerRetryTookOverThread(
  bb: ProviderRetryReadApi,
  threadId: string,
): Promise<boolean> {
  try {
    const queued = queuedRowsSchema.parse(
      await bb.sdk.threads.queue.list({ threadId }),
    );
    if (queued.some((row) => row.payload.kind === "retry")) return true;
    const [latest] = latestTurnRequestSchema.parse(
      await bb.sdk.threads.events.list({
        threadId,
        types: ["client/turn/requested"],
        order: "desc",
        limit: "1",
      }),
    );
    return latest?.data.retryOfRequestId !== undefined;
  } catch (error) {
    if (
      error instanceof Error &&
      threadGoneErrorSchema.safeParse(error).success
    ) {
      return false;
    }
    throw error;
  }
}

export async function providerRetrySkipReason(
  bb: ProviderRetryReadApi,
  db: Db,
  automation: AutomationRow,
): Promise<string | null> {
  const [latestRun] = listAutomationRuns(db, {
    automationId: automation.id,
    limit: 1,
  });
  if (
    latestRun === undefined ||
    latestRun.status !== "failed" ||
    latestRun.trigger !== "schedule" ||
    latestRun.threadId === null
  ) {
    return null;
  }
  if (!(await providerRetryTookOverThread(bb, latestRun.threadId))) {
    return null;
  }
  return `provider retry is re-running failed run ${latestRun.id} in thread ${latestRun.threadId}`;
}
