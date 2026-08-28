#!/usr/bin/env node
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
} from "node:fs";
import { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";

const STALL_MS = 5_000;
const LOOKAHEAD_MS = 750;
const CURSOR_POLL_MS = 5;
const EMIT_GAP_MS = 2;
const RESPONSE_GAP_MS = 50;
const SESSION_DEFINING_KEY =
  /^(thread|session)\/(start|resume|fork|new|load|archive|unarchive|name\/set)$/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--recording" || key === "--dialect" || key === "--state") {
      args[key.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  if (!args.recording || !args.dialect || !args.state) {
    throw new Error(
      "usage: --recording <dir> --dialect <json-rpc|claude-cli|pi-rpc> --state <dir>",
    );
  }
  return args;
}

function isStringValue(value) {
  return String(value) === value;
}

function isObjectValue(value) {
  return value !== null && Object(value) === value;
}

function readLane(dir, direction) {
  const file = join(dir, `${direction}.ndjson`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      ...entry,
      run: Number.isFinite(entry.run) ? entry.run : 0,
    }));
}

const DIALECTS = {
  "json-rpc": {
    classify(message) {
      const hasId = isStringValue(message.id) || Number.isFinite(message.id);
      if (hasId && isStringValue(message.method)) {
        return { kind: "request", id: message.id, key: message.method };
      }
      if (hasId) {
        return { kind: "response", id: message.id, key: "response" };
      }
      if (isStringValue(message.method)) {
        return { kind: "notification", key: message.method };
      }
      return { kind: "notification", key: "?" };
    },
    isInitialize(classified) {
      return classified.kind === "request" && classified.key === "initialize";
    },
    withResponseId(message, id) {
      return { ...message, id };
    },
    genericResponse(id) {
      return { jsonrpc: "2.0", id, result: {} };
    },
  },
  "claude-cli": {
    classify(message) {
      if (message.type === "control_request") {
        return {
          kind: "request",
          id: message.request_id,
          key: `control_request:${message.request?.subtype ?? "?"}`,
        };
      }
      if (message.type === "control_response") {
        return {
          kind: "response",
          id: message.response?.request_id,
          key: "control_response",
        };
      }
      return {
        kind: "notification",
        key: `${message.type ?? "?"}${message.subtype ? `:${message.subtype}` : ""}`,
      };
    },
    isInitialize(classified) {
      return (
        classified.kind === "request" &&
        classified.key === "control_request:initialize"
      );
    },
    withResponseId(message, id) {
      return { ...message, response: { ...message.response, request_id: id } };
    },
    genericResponse(id) {
      return {
        type: "control_response",
        response: { subtype: "success", request_id: id, response: {} },
      };
    },
  },
  "pi-rpc": {
    channel: {
      key: "bbChannel",
      childToBridgeFd: 3,
      bridgeToChildFd: 4,
    },
    classify(message) {
      const channel = message.bbChannel;
      if (isObjectValue(channel)) {
        if (channel.kind === "tool-call" || channel.kind === "request") {
          return {
            kind: "request",
            id: channel.id,
            key: `channel:${channel.kind}${channel.method ? `:${channel.method}` : ""}`,
            channel: true,
          };
        }
        if (channel.kind === "tool-result" || channel.kind === "reply") {
          return {
            kind: "response",
            id: channel.id,
            key: "channel:response",
            channel: true,
          };
        }
        return {
          kind: "notification",
          key: `channel:${channel.kind ?? "?"}`,
          channel: true,
        };
      }
      if (message.type === "response") {
        return { kind: "response", id: message.id, key: "response" };
      }
      if (isStringValue(message.type) && isStringValue(message.id)) {
        return { kind: "request", id: message.id, key: message.type };
      }
      return { kind: "notification", key: `event:${message.type ?? "?"}` };
    },
    isInitialize(classified) {
      return (
        classified.kind === "request" &&
        classified.key === "get_state" &&
        classified.id === "bb-1"
      );
    },
    withResponseId(message, id) {
      if (isObjectValue(message.bbChannel)) {
        return { ...message, bbChannel: { ...message.bbChannel, id } };
      }
      return { ...message, id };
    },
    genericResponse(id, classified) {
      if (classified?.channel) {
        return { bbChannel: { kind: "reply", id, result: {} } };
      }
      return { id, type: "response", command: "?", success: true, data: {} };
    },
  },
};

function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    return isObjectValue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildSegments(entries, dialect) {
  const segments = [];
  let current = null;
  for (const entry of entries) {
    const message = parseLine(entry.line);
    const classified =
      message === null
        ? { kind: "raw", key: "raw" }
        : dialect.classify(message);
    const startsSegment =
      entry.dir === "bridge→provider" &&
      message !== null &&
      dialect.isInitialize(classified);
    if (current === null || startsSegment) {
      current = [];
      segments.push(current);
    }
    current.push({ ...entry, message, classified });
  }
  return segments;
}

function claimSegmentIndex(stateDir) {
  mkdirSync(stateDir, { recursive: true });
  for (let index = 0; index < 10_000; index += 1) {
    try {
      mkdirSync(join(stateDir, `segment-${index}`));
      return index;
    } catch (error) {
      if (error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("too many replay children");
}

function releaseSegmentIndex(stateDir, index) {
  try {
    rmdirSync(join(stateDir, `segment-${index}`));
  } catch {}
}

function readCursor(stateDir) {
  let text;
  try {
    text = readFileSync(join(stateDir, "cursor"), "utf8").trim();
  } catch {
    return null;
  }
  if (text === "end" || text === "") return null;
  const [run, seq] = text.split(" ").map(Number);
  return { run, seq };
}

function cursorAllows(cursor, entry) {
  if (cursor === null) return true;
  return (
    entry.run < cursor.run ||
    (entry.run === cursor.run && entry.seq < cursor.seq)
  );
}

function firstSessionDefiningKey(script) {
  for (const step of script) {
    if (
      step.dir === "bridge→provider" &&
      step.classified.kind === "request" &&
      SESSION_DEFINING_KEY.test(step.classified.key)
    ) {
      return step.classified.key;
    }
  }
  return null;
}

function hookCallbackIdMap(recordedInitialize, liveInitialize) {
  const map = new Map();
  const recordedHooks = recordedInitialize?.request?.hooks ?? {};
  const liveHooks = liveInitialize?.request?.hooks ?? {};
  for (const [event, recordedMatchers] of Object.entries(recordedHooks)) {
    const liveMatchers = liveHooks[event] ?? [];
    recordedMatchers.forEach((recordedMatcher, matcherIndex) => {
      const liveMatcher = liveMatchers[matcherIndex];
      (recordedMatcher.hookCallbackIds ?? []).forEach((recordedId, idIndex) => {
        const liveId = liveMatcher?.hookCallbackIds?.[idIndex];
        if (liveId !== undefined) map.set(recordedId, liveId);
      });
    });
  }
  return map;
}

function readNewlineDelimitedLines(input, onLine) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  input.on("data", (chunk) => {
    const text = isStringValue(chunk) ? chunk : decoder.write(chunk);
    let start = 0;
    for (;;) {
      const index = text.indexOf("\n", start);
      if (index === -1) {
        pending += text.slice(start);
        return;
      }
      const line = pending + text.slice(start, index);
      pending = "";
      start = index + 1;
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  });
}

function main() {
  if (process.argv.includes("--version")) {
    process.stdout.write("0.0.0-replay\n");
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const dialect = DIALECTS[args.dialect];
  if (!dialect) throw new Error(`unknown dialect ${args.dialect}`);

  const entries = [
    ...readLane(args.recording, "provider→bridge"),
    ...readLane(args.recording, "bridge→provider"),
  ].sort((left, right) => left.run - right.run || left.seq - right.seq);
  const segments = buildSegments(entries, dialect);
  const segmentIndex = claimSegmentIndex(args.state);
  let script = segments[segmentIndex] ?? [];
  const log = (text) =>
    process.stderr.write(`[replay-child #${segmentIndex}] ${text}\n`);
  if (script.length === 0) {
    log(
      `no recorded segment ${segmentIndex} (recording has ${segments.length}); answering generically`,
    );
  }
  const segmentSessionKey = firstSessionDefiningKey(script);
  let sawSessionDefiningRequest = false;
  let cursorWait = null;

  let position = 0;
  const pendingLive = [];
  const liveIdByRecordedId = new Map();
  const skippedRecordedIds = new Set();
  let hookIds = new Map();
  let stallTimer = null;
  let lookaheadTimer = null;
  let emitTimer = null;

  const channel = dialect.channel ?? null;
  const channelOut = channel
    ? createWriteStream(null, { fd: channel.childToBridgeFd })
    : null;
  function emit(message) {
    if (channel && isObjectValue(message[channel.key])) {
      channelOut.write(`${JSON.stringify(message[channel.key])}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  function emitRecorded(step) {
    const { message, classified } = step;
    if (classified.kind === "response") {
      const liveId = liveIdByRecordedId.get(String(classified.id));
      emit(
        dialect.withResponseId(
          message,
          liveId === undefined ? classified.id : liveId,
        ),
      );
      return;
    }
    if (
      classified.kind === "request" &&
      classified.key === "control_request:hook_callback" &&
      message.request &&
      hookIds.has(message.request.callback_id)
    ) {
      emit({
        ...message,
        request: {
          ...message.request,
          callback_id: hookIds.get(message.request.callback_id),
        },
      });
      return;
    }
    emit(message);
  }

  function takeMatchingLive(expected) {
    for (let index = 0; index < pendingLive.length; index += 1) {
      const live = pendingLive[index];
      const { classified } = live;
      if (classified.kind !== expected.classified.kind) continue;
      const matches =
        classified.kind === "response"
          ? String(classified.id) === String(expected.classified.id)
          : classified.key === expected.classified.key;
      if (matches) {
        pendingLive.splice(index, 1);
        return live;
      }
    }
    return null;
  }

  function scheduleAdvance(gapMs = EMIT_GAP_MS) {
    if (emitTimer !== null) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      advance();
    }, gapMs);
  }

  function advance() {
    if (emitTimer !== null) {
      return;
    }
    while (position < script.length) {
      const step = script[position];
      if (step.dir === "provider→bridge") {
        if (
          step.classified.kind !== "response" &&
          !cursorAllows(readCursor(args.state), step)
        ) {
          if (cursorWait === null) {
            cursorWait = setTimeout(() => {
              cursorWait = null;
              advance();
            }, CURSOR_POLL_MS);
          }
          return;
        }
        if (step.message === null) {
          process.stdout.write(`${step.line}\n`);
          position += 1;
          scheduleAdvance();
          return;
        }
        if (step.classified.kind === "response") {
          if (skippedRecordedIds.has(String(step.classified.id))) {
            position += 1;
            continue;
          }
          if (!liveIdByRecordedId.has(String(step.classified.id))) {
            return;
          }
        }
        emitRecorded(step);
        position += 1;
        scheduleAdvance(
          step.classified.kind === "response" ? RESPONSE_GAP_MS : EMIT_GAP_MS,
        );
        return;
      }
      const live = takeMatchingLive(step);
      if (live === null) {
        return;
      }
      if (step.classified.kind === "request") {
        liveIdByRecordedId.set(String(step.classified.id), live.classified.id);
        if (
          dialect.isInitialize(step.classified) &&
          args.dialect === "claude-cli"
        ) {
          hookIds = hookCallbackIdMap(step.message, live.message);
        }
      }
      position += 1;
    }
  }

  function lookAhead() {
    lookaheadTimer = null;
    for (const live of pendingLive) {
      for (let index = position + 1; index < script.length; index += 1) {
        const step = script[index];
        if (step.dir !== "bridge→provider") continue;
        const same =
          step.classified.kind === live.classified.kind &&
          (step.classified.kind === "response"
            ? String(step.classified.id) === String(live.classified.id)
            : step.classified.key === live.classified.key);
        if (!same) continue;
        const skipped = [];
        for (let cursor = position; cursor < index; cursor += 1) {
          const between = script[cursor];
          if (between.dir === "bridge→provider") {
            if (between.classified.kind === "request") {
              skippedRecordedIds.add(String(between.classified.id));
            }
            skipped.push(between.classified.key);
          } else if (between.message === null) {
            process.stdout.write(`${between.line}\n`);
          } else if (
            between.classified.kind !== "response" ||
            liveIdByRecordedId.has(String(between.classified.id))
          ) {
            emitRecorded(between);
          }
        }
        log(
          `bridge skipped recorded ${skipped.join(", ")}; resuming at ${live.classified.key}`,
        );
        position = index;
        advance();
        armStall();
        return;
      }
    }
  }

  function answerGenerically(live, reason) {
    if (live.classified.kind === "request") {
      log(
        `${reason}: answering ${live.classified.key} (${String(live.classified.id)}) generically`,
      );
      emit(dialect.genericResponse(live.classified.id, live.classified));
    } else {
      log(
        `${reason}: dropping unmatched ${live.classified.kind} ${live.classified.key}`,
      );
    }
  }

  function onStall() {
    stallTimer = null;
    if (pendingLive.length === 0) return;
    const expected = script[position];
    log(
      `stalled for ${STALL_MS}ms at step ${position}/${script.length}` +
        (expected
          ? ` (expecting ${expected.dir} ${expected.classified.key})`
          : ""),
    );
    for (const live of pendingLive.splice(0)) {
      answerGenerically(live, "stall");
    }
    advance();
  }

  function armStall() {
    if (stallTimer !== null) clearTimeout(stallTimer);
    if (lookaheadTimer !== null) clearTimeout(lookaheadTimer);
    stallTimer = pendingLive.length > 0 ? setTimeout(onStall, STALL_MS) : null;
    lookaheadTimer =
      pendingLive.length > 0 ? setTimeout(lookAhead, LOOKAHEAD_MS) : null;
  }

  function releaseSegment(live) {
    log(
      `first session request ${live.classified.key} does not match the segment's ${segmentSessionKey}; releasing segment ${segmentIndex}`,
    );
    releaseSegmentIndex(args.state, segmentIndex);
    script = [];
    position = 0;
    for (const pending of pendingLive.splice(0)) {
      answerGenerically(pending, "released segment");
    }
  }

  function onLiveMessage(message) {
    const live = { message, classified: dialect.classify(message) };
    if (
      !sawSessionDefiningRequest &&
      live.classified.kind === "request" &&
      SESSION_DEFINING_KEY.test(live.classified.key)
    ) {
      sawSessionDefiningRequest = true;
      if (
        segmentSessionKey !== null &&
        live.classified.key !== segmentSessionKey
      ) {
        releaseSegment(live);
      }
    }
    if (position >= script.length) {
      answerGenerically(live, "past end of segment");
      return;
    }
    pendingLive.push(live);
    advance();
    armStall();
  }

  readNewlineDelimitedLines(process.stdin, (line) => {
    const message = parseLine(line);
    if (message !== null) onLiveMessage(message);
  });
  process.stdin.on("end", () => {
    process.exit(0);
  });
  if (channel) {
    const channelIn = new Socket({
      fd: channel.bridgeToChildFd,
      readable: true,
      writable: false,
    });
    channelIn.on("error", () => {});
    channelIn.unref();
    readNewlineDelimitedLines(channelIn, (line) => {
      const message = parseLine(line);
      if (message !== null) onLiveMessage({ [channel.key]: message });
    });
  }
  process.on("SIGTERM", () => process.exit(0));

  advance();
}

main();
