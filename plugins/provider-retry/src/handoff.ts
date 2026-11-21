import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readRetryDiagnostic } from "./diagnostics.js";
import { findQueuedRetry } from "./queued-retries.js";

export const HANDOFF_MESSAGE_LIMIT = 20;
export const HANDOFF_OUTPUT_LIMIT = 4_000;

const providerSchema = z.object({ id: z.string(), name: z.string() });

export const handoffOfferSchema = z.object({
  threadId: z.string(),
  from: providerSchema,
  to: providerSchema,
  retryAt: z.number().nullable(),
  continuedIn: z.string().nullable(),
});
export type HandoffOffer = z.infer<typeof handoffOfferSchema>;

export function handoffTag(threadId: string): string {
  return `handoff:${threadId}`;
}

export const handoffContract = defineRpcContract({
  "handoff.get": {
    tags: ({ threadId }) => [handoffTag(threadId)],
    input: z.object({ threadId: z.string().min(1) }),
    output: handoffOfferSchema.nullable(),
  },
  "handoff.start": {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ threadId: z.string() }),
  },
});

const handoffRecordSchema = z.object({
  requestId: z.string(),
  threadId: z.string(),
});

function handoffRecordKey(threadId: string): string {
  return `handoff:${threadId}`;
}

async function readContinuedIn(
  bb: BbPluginApi,
  threadId: string,
  requestId: string,
): Promise<string | null> {
  const record = handoffRecordSchema
    .nullable()
    .parse((await bb.storage.kv.get(handoffRecordKey(threadId))) ?? null);
  return record?.requestId === requestId ? record.threadId : null;
}

export class HandoffUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffUnavailableError";
  }
}

export function noHandoffMessage(threadId: string): string {
  return `${threadId} is not waiting on a usage limit, or no other fallback provider is available.`;
}

const turnRequestSchema = z.object({ requestId: z.string() });

async function latestRequestId(
  bb: BbPluginApi,
  threadId: string,
): Promise<string | null> {
  const [latest] = await bb.sdk.threads.events.list({
    threadId,
    types: ["client/turn/requested"],
    order: "desc",
    limit: "1",
  });
  if (latest === undefined) return null;
  const parsed = turnRequestSchema.safeParse(latest.data);
  return parsed.success ? parsed.data.requestId : null;
}

async function resolveHandoff(bb: BbPluginApi, threadId: string) {
  const diagnostic = await readRetryDiagnostic(bb, threadId);
  if (diagnostic === null || !diagnostic.rateLimited) return null;
  const thread = await bb.sdk.threads.get({ threadId });
  if (thread.status !== "error") return null;
  if (thread.originPluginId !== null && thread.originPluginId !== bb.pluginId)
    return null;
  if ((await latestRequestId(bb, threadId)) !== diagnostic.requestId)
    return null;
  const { fallbackProviderId } = (await bb.sdk.system.config()).generalSettings;
  if (fallbackProviderId === null || fallbackProviderId === thread.providerId)
    return null;
  const providers = await bb.sdk.providers.list(
    thread.environmentId === null
      ? {}
      : { environmentId: thread.environmentId },
  );
  const to = providers.find(
    (provider) => provider.id === fallbackProviderId && provider.available,
  );
  if (to === undefined) return null;
  const from = providers.find((provider) => provider.id === thread.providerId);
  const queued = await findQueuedRetry(bb, threadId);
  const offer: HandoffOffer = {
    threadId,
    continuedIn: await readContinuedIn(bb, threadId, diagnostic.requestId),
    from: {
      id: thread.providerId,
      name: from?.displayName ?? thread.providerId,
    },
    to: { id: to.id, name: to.displayName },
    retryAt: queued?.sendAt ?? null,
  };
  return { offer, thread, requestId: diagnostic.requestId, queued };
}

export async function readHandoffOffer(
  bb: BbPluginApi,
  threadId: string,
): Promise<HandoffOffer | null> {
  return (await resolveHandoff(bb, threadId))?.offer ?? null;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildHandoffPrompt(args: {
  offer: HandoffOffer;
  messages: readonly { role: "user" | "assistant"; preview: string }[];
  output: string | null;
}): string {
  const { offer } = args;
  const lines = [
    `Continue the work of thread ${offer.threadId}. It ran on ${offer.from.name}, which reached its usage limit.`,
    "You work in the same workspace. It can hold unfinished changes, so check the working tree before you edit files.",
    `Run \`bb thread log ${offer.threadId}\` to read the full conversation.`,
  ];
  const messages = args.messages.slice(-HANDOFF_MESSAGE_LIMIT);
  if (messages.length > 0) {
    lines.push(
      "",
      `The last ${messages.length} messages, each cut to 200 characters:`,
      "",
      ...messages.map(
        (message) =>
          `${message.role === "user" ? "User" : "Agent"}: ${oneLine(message.preview)}`,
      ),
    );
  }
  const output = args.output?.trim() ?? "";
  const lastMessage = messages.at(-1);
  const outputShown =
    lastMessage?.role === "assistant" &&
    oneLine(lastMessage.preview) === oneLine(output);
  if (output !== "" && !outputShown) {
    lines.push(
      "",
      "The last agent output:",
      "",
      truncate(output, HANDOFF_OUTPUT_LIMIT),
    );
  }
  lines.push("", "Continue with the last user request.");
  return lines.join("\n");
}

export async function startHandoff(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ threadId: string }> {
  const resolved = await resolveHandoff(bb, threadId);
  if (resolved === null)
    throw new HandoffUnavailableError(noHandoffMessage(threadId));
  const { offer, thread, requestId, queued } = resolved;
  if (offer.continuedIn !== null) return { threadId: offer.continuedIn };
  const [outline, output] = await Promise.all([
    bb.sdk.threads.conversationOutline({ threadId }),
    bb.sdk.threads.output({ threadId }),
  ]);
  if (queued !== null) {
    try {
      await bb.sdk.threads.queuedMessages.delete({
        threadId,
        queuedMessageId: queued.id,
      });
    } catch (error) {
      bb.rpc.experimental_invalidate([handoffTag(threadId)]);
      throw new HandoffUnavailableError(
        `The retry of ${threadId} already started, so it was not continued in ${offer.to.name}: ${String(error)}`,
      );
    }
  }
  let created: { id: string };
  try {
    created = await bb.sdk.threads.spawn({
      projectId: thread.projectId,
      providerId: offer.to.id,
      origin: "plugin",
      originPluginId: bb.pluginId,
      ...(thread.title === null ? {} : { title: thread.title }),
      environment:
        thread.environmentId === null
          ? { type: "project-default" }
          : { type: "reuse", environmentId: thread.environmentId },
      prompt: buildHandoffPrompt({
        offer,
        messages: outline.items,
        output: output.output,
      }),
    });
  } catch (error) {
    if (queued !== null) {
      await bb.sdk.threads
        .retry({
          threadId,
          turnRequestId: requestId,
          ...(queued.sendAt === null ? {} : { sendAt: queued.sendAt }),
          reason: "Rate limited",
        })
        .catch((restoreError: unknown) =>
          bb.log.warn(
            `Could not restore the retry of ${threadId}: ${String(restoreError)}`,
          ),
        );
    }
    throw error;
  }
  try {
    await bb.storage.kv.set(handoffRecordKey(threadId), {
      requestId,
      threadId: created.id,
    });
  } catch (error) {
    bb.log.warn(
      `Continued ${threadId} in ${created.id}, but could not record it: ${String(error)}`,
    );
  }
  bb.rpc.experimental_invalidate([handoffTag(threadId)]);
  return { threadId: created.id };
}
