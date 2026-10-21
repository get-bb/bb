import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import * as zlib from "node:zlib";

const REPLY = "BB_FIRST_RUN_OK";
const BODY_LIMIT = 8 * 1024 * 1024;
const ROUTES = new Set([
  "/messages",
  "/v1/messages",
  "/messages/count_tokens",
  "/v1/messages/count_tokens",
  "/responses",
  "/v1/responses",
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function sendEvents(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "request-id": `first-run-${randomUUID()}`,
  });
  for (const event of events) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > BODY_LIMIT) throw new Error("Request exceeds fixture limit");
    chunks.push(chunk);
  }
  let bytes = Buffer.concat(chunks);
  const encoding = request.headers["content-encoding"];
  if (encoding && encoding !== "identity") {
    const decompress = {
      gzip: zlib.gunzipSync,
      deflate: zlib.inflateSync,
      br: zlib.brotliDecompressSync,
      zstd: zlib.zstdDecompressSync,
    }[encoding];
    if (typeof decompress !== "function") {
      throw new Error("Unsupported fixture request encoding");
    }
    bytes = decompress(bytes, { maxOutputLength: BODY_LIMIT });
  }
  const body = JSON.parse(bytes.toString("utf8"));
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body.stream !== undefined && typeof body.stream !== "boolean") ||
    (body.model !== undefined && typeof body.model !== "string")
  ) {
    throw new Error("Invalid fixture request");
  }
  return body;
}

function anthropicReply(response, body) {
  const message = {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: body.model ?? "claude-sonnet-4-6",
    content: [{ type: "text", text: REPLY }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
  if (!body.stream) {
    sendJson(response, 200, message);
    return;
  }
  sendEvents(response, [
    {
      type: "message_start",
      message: {
        ...message,
        content: [],
        stop_reason: null,
        usage: { ...message.usage, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: REPLY },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]);
}

function openaiReply(response, body) {
  const part = { type: "output_text", text: REPLY, annotations: [] };
  const item = {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [part],
  };
  const result = {
    id: `resp_${randomUUID()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: body.model ?? "gpt-5",
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [item],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
  };
  if (!body.stream) {
    sendJson(response, 200, result);
    return;
  }
  const position = { item_id: item.id, output_index: 0, content_index: 0 };
  const pending = { ...result, output: [], status: "in_progress", usage: null };
  const events = [
    { type: "response.created", response: pending },
    { type: "response.in_progress", response: pending },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      ...position,
      part: { ...part, text: "" },
    },
    { type: "response.output_text.delta", ...position, delta: REPLY },
    { type: "response.output_text.done", ...position, text: REPLY },
    { type: "response.content_part.done", ...position, part },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: result },
  ];
  sendEvents(
    response,
    events.map((event, sequence_number) => ({ ...event, sequence_number })),
  );
}

export async function startModelServer() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const record = {
      method: request.method ?? "UNKNOWN",
      path: ROUTES.has(pathname) ? pathname : "unhandled",
      stream: false,
      status: 0,
    };
    requests.push(record);
    try {
      if (request.method !== "POST" || !ROUTES.has(pathname)) {
        record.status = 404;
        sendJson(response, 404, { error: "Unhandled first-run fixture route" });
        return;
      }
      const body = await readBody(request);
      record.stream = body.stream === true;
      record.status = 200;
      if (pathname.endsWith("/count_tokens")) {
        sendJson(response, 200, { input_tokens: 1 });
      } else if (pathname.endsWith("/messages")) {
        anthropicReply(response, body);
      } else {
        openaiReply(response, body);
      }
    } catch {
      record.status = 400;
      if (!response.headersSent) {
        sendJson(response, 400, { error: "Invalid first-run fixture request" });
      } else {
        response.destroy();
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Expected a TCP address for the model fixture");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    reply: REPLY,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
