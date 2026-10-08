import { once } from "node:events";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";

const [mode, progressPath] = process.argv.slice(2);
const threadId = "codex-backpressure";
const turnId = "turn-backpressure";

async function send(message) {
  const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    if (!process.stdout.write(bytes.subarray(offset, offset + 16_384))) {
      await once(process.stdout, "drain");
    }
  }
}

async function notify(method, params) {
  await send({
    jsonrpc: "2.0",
    method,
    params: { threadId, turnId, ...params },
  });
}

async function emitFileChange(index) {
  const completed = index % 2 === 1;
  const message = {
    jsonrpc: "2.0",
    method: completed ? "item/completed" : "item/started",
    params: {
      threadId,
      turnId,
      item: {
        type: "fileChange",
        id: `patch-${Math.floor(index / 2)}`,
        status: completed ? "completed" : "inProgress",
        changes: [{ path: "synthetic.txt", kind: { type: "add" }, diff: "" }],
      },
    },
  };
  const characters = index % 2 === 0 ? 9_418_764 : 11_102_429;
  const suffix = "é🙂界";
  message.params.item.changes[0].diff =
    "x".repeat(characters - JSON.stringify(message).length - suffix.length) +
    suffix;
  await send(message);
  appendFileSync(progressPath, `${index}\n`);
}

async function handleRequest(message) {
  if (message.id === undefined) return;
  if (message.method === "thread/start") {
    await send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }
  if (message.method !== "turn/start") {
    await send({ id: message.id, result: {} });
    return;
  }
  await notify("turn/started", {
    turn: { id: turnId, items: [], status: "inProgress", error: null },
  });
  await send({ id: message.id, result: { turn: { id: turnId } } });
  for (let index = 0; index < (mode === "burst" ? 8 : 1); index += 1) {
    await emitFileChange(index);
  }
  if (mode === "exit") {
    await setTimeout(50);
    await notify("item/completed", {
      item: {
        type: "agentMessage",
        id: "final-tail",
        text: "tail survived child exit",
        phase: null,
      },
    });
  }
  await notify("turn/completed", {
    turn: { id: turnId, items: [], status: "completed", error: null },
  });
  appendFileSync(progressPath, "done\n");
  if (mode === "exit") process.stdout.end(() => process.exit(0));
}

const lines = createInterface({ input: process.stdin });
let requests = Promise.resolve();
lines.on("line", (line) => {
  requests = requests.then(() => handleRequest(JSON.parse(line)));
  requests.catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
});
