#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { StringDecoder } from "node:string_decoder";

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1)
    throw new Error("usage: --probe-log <dir> [...] -- <command...>");
  const own = argv.slice(0, separator);
  const args = { command: argv.slice(separator + 1) };
  for (let index = 0; index < own.length; index += 2) {
    args[own[index].replace(/^--/, "")] = own[index + 1];
  }
  if (!args["probe-log"] || args.command.length === 0) {
    throw new Error("usage: --probe-log <dir> [...] -- <command...>");
  }
  return args;
}

function parseJson(line) {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function withoutIds(message) {
  const { id: _id, ...rest } = message;
  return rest;
}

function recordedExitLine(recordingDir, position) {
  const [run, seq] = position.split(":").map(Number);
  const lane = readFileSync(
    join(recordingDir, "provider→bridge.ndjson"),
    "utf8",
  );
  for (const raw of lane.split("\n")) {
    if (raw === "") continue;
    const entry = JSON.parse(raw);
    if ((entry.run ?? 0) === run && entry.seq === seq) {
      const message = parseJson(entry.line);
      if (message === null)
        throw new Error(`exit line ${position} is not JSON`);
      return withoutIds(message);
    }
  }
  throw new Error(`no provider→bridge line at ${position}`);
}

function recordedPromptIds(recordingDir) {
  const prompts = [];
  const lane = readFileSync(
    join(recordingDir, "bridge→provider.ndjson"),
    "utf8",
  );
  for (const raw of lane.split("\n")) {
    if (raw === "") continue;
    const message = parseJson(JSON.parse(raw).line);
    if (message?.type === "user" && typeof message.uuid === "string") {
      prompts.push({
        content: JSON.stringify(message.message?.content),
        uuid: message.uuid,
      });
    }
  }
  return prompts;
}

function eachLine(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  stream.on("data", (chunk) => {
    const text = pending + decoder.write(chunk);
    const lines = text.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines)
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.command.includes("api")) {
  const call = spawnSync(args.command[0], args.command.slice(1), {
    stdio: "inherit",
  });
  process.exit(call.status ?? 1);
}
mkdirSync(args["probe-log"], { recursive: true });
const logFile = join(args["probe-log"], `${process.pid}.ndjson`);
const log = (entry) =>
  appendFileSync(logFile, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
log({ kind: "spawn", argv: args.command.slice(1), env: process.env });

const exitLine =
  args["exit-after"] !== undefined && args.recording !== undefined
    ? recordedExitLine(args.recording, args["exit-after"])
    : null;
const exitSignal = args["exit-signal"] ?? "SIGKILL";
const unmatchedPrompts =
  args.recording === undefined ? [] : recordedPromptIds(args.recording);
const liveIdByRecordedId = new Map();

function alignPromptId(message) {
  if (message?.type !== "user" || typeof message.uuid !== "string") return;
  const content = JSON.stringify(message.message?.content);
  const index = unmatchedPrompts.findIndex(
    (prompt) => prompt.content === content,
  );
  if (index === -1) return;
  const [recorded] = unmatchedPrompts.splice(index, 1);
  liveIdByRecordedId.set(recorded.uuid, message.uuid);
}

function withLivePromptIds(line) {
  let aligned = line;
  for (const [recorded, live] of liveIdByRecordedId) {
    if (aligned.includes(recorded))
      aligned = aligned.split(recorded).join(live);
  }
  return aligned;
}

const CHANNEL_ENV = "BB_PI_BRIDGE_CHANNEL";
const upstreamChannel = process.env[CHANNEL_ENV];
const channelOnDisk = process.platform !== "win32";
const channelPath =
  upstreamChannel === undefined
    ? undefined
    : channelOnDisk
      ? join(tmpdir(), `bb-probe-${process.pid}.sock`)
      : `\\\\.\\pipe\\bb-probe-${process.pid}`;
if (channelPath !== undefined) {
  if (channelOnDisk) rmSync(channelPath, { force: true });
  const server = createServer((downstream) => {
    const upstream = connect(upstreamChannel);
    upstream.on("error", () => downstream.destroy());
    downstream.on("error", () => upstream.destroy());
    eachLine(downstream, (line) => upstream.write(`${line}\n`));
    eachLine(upstream, (line) => {
      const message = parseJson(line);
      log({
        kind: "line",
        line: JSON.stringify({ bbChannel: message ?? line }),
      });
      if (message?.kind === "request" && message.method === "refresh-models") {
        upstream.write(
          `${JSON.stringify({ kind: "reply", id: message.id, result: { refreshed: true } })}\n`,
        );
        return;
      }
      downstream.write(`${line}\n`);
    });
    downstream.on("close", () => upstream.end());
    upstream.on("close", () => downstream.end());
  });
  server.listen(channelPath);
  server.unref();
  if (channelOnDisk) {
    process.on("exit", () => rmSync(channelPath, { force: true }));
  }
}

const child = spawn(args.command[0], args.command.slice(1), {
  stdio: ["pipe", "pipe", "pipe"],
  env:
    channelPath === undefined
      ? process.env
      : { ...process.env, [CHANNEL_ENV]: channelPath },
});

const stderrLog = createWriteStream(
  join(args["probe-log"], `${process.pid}.stderr`),
);
child.stderr.on("data", (chunk) => {
  stderrLog.write(chunk);
  process.stderr.write(chunk);
});

let dying = false;
function die() {
  if (dying) return;
  dying = true;
  log({ kind: "exit", signal: exitSignal });
  child.kill("SIGKILL");
  process.kill(process.pid, exitSignal);
}

eachLine(child.stdout, (raw) => {
  if (dying) return;
  const line = withLivePromptIds(raw);
  process.stdout.write(`${line}\n`);
  if (exitLine === null) return;
  const message = parseJson(line);
  if (message !== null && isDeepStrictEqual(withoutIds(message), exitLine)) {
    process.stdout.write("", die);
  }
});
eachLine(process.stdin, (line) => {
  log({ kind: "line", line });
  alignPromptId(parseJson(line));
  if (!dying && child.stdin.writable) child.stdin.write(`${line}\n`);
});
process.stdin.on("end", () => {
  log({ kind: "stdin-end" });
  child.stdin.end();
});
process.on("SIGTERM", () => {
  log({ kind: "signal", signal: "SIGTERM" });
  child.kill("SIGTERM");
});
child.on("exit", (code, signal) => {
  if (dying) return;
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
