import { experimental_BbHttpError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const RETRY_DECISION_WAIT_MS = 60_000;

const PROVIDER_RETRY_PLUGIN_ID = "provider-retry";
const PROVIDER_RETRY_DECISION_METHOD = "decision.get";

type Sdk = BbPluginApi["sdk"];
export type RetryHandoffApi = {
  sdk: {
    threads: Pick<Sdk["threads"], "get"> & {
      queue: Pick<Sdk["threads"]["queue"], "list">;
      events: Pick<Sdk["threads"]["events"], "list">;
    };
    plugins: Pick<Sdk["plugins"], "experimental_discoverRpc" | "callRpc">;
  };
};

export type RetryHandoff =
  | { kind: "stand-down"; reason: string }
  | { kind: "wait" }
  | { kind: "re-run" };

const turnRequestSchema = z
  .object({
    requestId: z.string(),
    retryOfRequestId: z.string().optional(),
  })
  .passthrough();

const providerRetryDecisionSchema = z
  .object({ requestId: z.string() })
  .passthrough()
  .nullable();

function isThreadGoneError(error: unknown): boolean {
  return error instanceof experimental_BbHttpError && error.status === 404;
}

async function readProviderRetryDecision(
  bb: RetryHandoffApi,
  threadId: string,
): Promise<{ requestId: string } | null | "absent"> {
  const sources = await bb.sdk.plugins.experimental_discoverRpc({
    pluginId: PROVIDER_RETRY_PLUGIN_ID,
    method: PROVIDER_RETRY_DECISION_METHOD,
  });
  if (sources.length === 0) return "absent";
  return bb.sdk.plugins.callRpc({
    pluginId: PROVIDER_RETRY_PLUGIN_ID,
    method: PROVIDER_RETRY_DECISION_METHOD,
    input: { threadId },
    outputSchema: providerRetryDecisionSchema,
    signal: AbortSignal.timeout(5_000),
  });
}

export async function readRetryHandoff(
  bb: RetryHandoffApi,
  args: { threadId: string; failedAt: number; now: number },
): Promise<RetryHandoff> {
  const { threadId } = args;
  let thread;
  try {
    thread = await bb.sdk.threads.get({ threadId });
  } catch (error) {
    if (isThreadGoneError(error)) return { kind: "re-run" };
    throw error;
  }
  if (thread.archivedAt !== null || thread.deletedAt !== null) {
    return { kind: "re-run" };
  }
  const decision = await readProviderRetryDecision(bb, threadId);
  const queued = (await bb.sdk.threads.queue.list({ threadId })).find(
    (row) => row.payload.kind === "retry",
  );
  if (queued?.payload.kind === "retry") {
    return {
      kind: "stand-down",
      reason: `a retry (${queued.payload.reason}) is queued in thread ${threadId}`,
    };
  }
  const [latest] = await bb.sdk.threads.events.list({
    threadId,
    types: ["client/turn/requested"],
    order: "desc",
    limit: "1",
  });
  const request =
    latest === undefined ? null : turnRequestSchema.parse(latest.data);
  if (thread.status !== "error") {
    return request?.retryOfRequestId === undefined
      ? { kind: "re-run" }
      : {
          kind: "stand-down",
          reason: `a retry of the failed turn ran in thread ${threadId}`,
        };
  }
  if (
    request === null ||
    decision === "absent" ||
    decision?.requestId === request.requestId ||
    args.now - args.failedAt >= RETRY_DECISION_WAIT_MS
  ) {
    return { kind: "re-run" };
  }
  return { kind: "wait" };
}
