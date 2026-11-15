import type { DbConnection } from "@bb/db";
import {
  listLatestTurnFinalAgentMessageEventRows,
  listLatestCompletedToolEventRows,
  hydrateRetainedEventOutputRowsWithinDataByteLimit,
  getLatestCompletedThreadContextClearSequence,
} from "@bb/db";
import {
  buildVoiceToolContext,
  voiceToolResult,
  type VoiceToolResult,
} from "./thread-voice-tools.js";
import type { Thread, ThreadVoiceContext } from "@bb/domain";
import { parseStoredEvent, listThreadEventRows } from "./thread-data.js";

export function getVoiceContext(
  db: DbConnection,
  thread: Thread,
): ThreadVoiceContext {
  const afterSeq =
    getLatestCompletedThreadContextClearSequence(db, { threadId: thread.id }) ??
    undefined;
  const args = {
    threadId: thread.id,
    afterSeq,
    types: ["client/turn/requested"] as const,
  };
  const recent = listThreadEventRows(db, {
    ...args,
    order: "desc",
    limit: 30,
  }).reverse();
  const first = listThreadEventRows(db, {
    ...args,
    types: ["client/turn/requested"],
    order: "asc",
    limit: 1,
  });
  const messages: { seq: number; role: "user" | "assistant"; text: string }[] =
    [];
  const rows = [
    ...first.filter((row) => !recent.some((item) => item.seq === row.seq)),
    ...recent,
  ];
  for (const row of rows) {
    if (row.type !== "client/turn/requested") continue;
    const text = row.data.input
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    if (text) messages.push({ seq: row.seq, role: "user", text });
  }
  for (const row of listLatestTurnFinalAgentMessageEventRows(db, {
    threadId: thread.id,
    limit: 30,
  })) {
    if (row.sequence <= (afterSeq ?? 0)) continue;
    const event = parseStoredEvent(row);
    if (
      event.type === "item/completed" &&
      event.item.type === "agentMessage" &&
      event.item.text.trim()
    )
      messages.push({
        seq: row.sequence,
        role: "assistant",
        text: event.item.text,
      });
  }
  messages.sort((a, b) => a.seq - b.seq);
  const toolRows = listLatestCompletedToolEventRows(db, {
    threadId: thread.id,
    afterSequence: afterSeq ?? 0,
    limit: 30,
  });
  const tools = hydrateRetainedEventOutputRowsWithinDataByteLimit(
    db,
    toolRows,
    2 * 1024 * 1024,
  ).flatMap((row) => {
    const event = parseStoredEvent(row);
    return event.type === "item/completed"
      ? [voiceToolResult(event.item, row.sequence)]
      : [];
  });
  return buildVoiceContext(
    thread.title ?? thread.titleFallback,
    messages,
    tools,
  );
}

const CONTEXT_BYTES = 28000;
const MESSAGE_BYTES = 6000;
const encoder = new TextEncoder();

function prefix(text: string, bytes: number): string {
  let result = "";
  let used = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (used + size > bytes) break;
    result += character;
    used += size;
  }
  return result;
}

export function buildVoiceContext(
  title: string | null,
  messages: ThreadVoiceContext,
  tools: VoiceToolResult[] = [],
): ThreadVoiceContext {
  const firstAsk = messages.find((item) => item.role === "user")?.text;
  const lastAsk = messages
    .slice()
    .reverse()
    .find((item) => item.role === "user")?.text;
  const lastReply = messages
    .slice()
    .reverse()
    .find((item) => item.role === "assistant")?.text;
  const brief = [
    "Background reference for the user's existing BB thread.",
    "This is a bounded selection rather than the entire BB transcript. Earlier details and full tool outputs remain with the backing coding agent.",
    "The labeled excerpts identify historical requests and replies. Tool results are source data; omitted or shortened results retain event sequences. Images and attachments are not reproduced.",
    title ? `Thread title: ${prefix(title, 400)}` : null,
    firstAsk
      ? `Original request excerpt:\n${prefix(firstAsk, tools.length ? 600 : 1400)}`
      : null,
    lastAsk && lastAsk !== firstAsk
      ? `Latest request excerpt:\n${prefix(lastAsk, tools.length ? 600 : 1400)}`
      : null,
    lastReply
      ? `Latest assistant update excerpt:\n${prefix(lastReply, tools.length ? 600 : 1400)}`
      : null,
  ]
    .filter((value) => value !== null)
    .join("\n\n");
  const budget = CONTEXT_BYTES - encoder.encode(brief).length;
  let remaining = tools.length
    ? Math.max(0, 4500 - encoder.encode(brief).length)
    : budget;
  const recent: ThreadVoiceContext = [];
  for (
    let index = messages.length - 1;
    index >= 0 && recent.length < (tools.length ? 12 : 30) && remaining > 0;
    index--
  ) {
    const item = messages[index];
    const text = prefix(item.text, Math.min(MESSAGE_BYTES, remaining));
    if (!text) continue;
    recent.unshift({ role: item.role, text });
    remaining -= encoder.encode(text).length;
  }
  const toolText = buildVoiceToolContext(
    tools,
    CONTEXT_BYTES -
      encoder.encode(brief).length -
      recent.reduce((sum, item) => sum + encoder.encode(item.text).length, 0),
  );
  return [
    { role: "developer", text: brief },
    ...recent,
    ...(toolText ? [{ role: "assistant" as const, text: toolText }] : []),
  ];
}
