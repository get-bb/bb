#!/usr/bin/env node
/**
 * A fake provider child that replays a bridge recording's provider lanes.
 *
 *   node replay-provider-child.mjs --recording <dir> --dialect <json-rpc|claude-cli> --state <dir>
 *
 * The bridge under test spawns this instead of the real CLI (`codex
 * app-server`, an ACP agent, the `claude` binary). It plays the recorded
 * `provider→bridge` lines back on stdout, gated on the bridge's own writes:
 * the recording's `bridge→provider` entries are *expectations*, and the script
 * does not advance past one until the live bridge has written a matching line
 * (same method or control subtype for requests and notifications, same id for
 * responses). Ids the bridge mints for its requests are mapped to the recorded
 * ones so the recorded responses answer the live requests; ids the provider
 * minted are replayed verbatim, so the bridge's answers match by id. This is
 * what makes the fake generic: the recording IS the script, and the same
 * program serves every JSON-RPC provider and the Claude CLI control protocol.
 *
 * One recording can span several children (a new child per session, per
 * resume, per bridge restart). The lanes are cut into segments at each
 * bridge-originated `initialize`, and every spawned child claims the next
 * unclaimed segment through the shared `--state` directory. A child whose
 * first session-level request does not match its segment's (a maintenance
 * child the thread recording never saw, such as codex's unarchive) releases
 * the segment for the next child and answers generically.
 *
 * The harness paces the replay through the `cursor` file in the state
 * directory: provider lines are emitted only up to the recorded position of
 * the next runtime request, so a steer or an interrupt lands between the same
 * two provider lines it did live.
 *
 * Divergence never hangs the bridge: a live request that matches nothing for
 * STALL_MS is answered with a generic success, and a child past the end of its
 * segment answers everything generically. Both are logged on stderr.
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const STALL_MS = 5_000;
/**
 * How long an unmatched live line waits for the in-order expectation before
 * the script skips ahead to a later expectation it does match. Long enough
 * for a bridge to send two requests in the other order; short enough that a
 * bridge version which simply never sends a recorded request costs little.
 */
const LOOKAHEAD_MS = 750;
const CURSOR_POLL_MS = 5;
/**
 * Gap between two emitted provider lines. A real provider never delivers a
 * response and the notification after it in one read; the bridge's response
 * handlers (which emit the steer's ack, say) must get the event loop between
 * them, or the replay reorders what the recording had in order.
 */
const EMIT_GAP_MS = 2;
/**
 * Gap after a response. The bridge continues its request's continuation in
 * a microtask once the line loop yields; a notification read in the same
 * chunk is handled first, so under load two milliseconds let a steer's ack
 * (emitted after `await request("turn/steer")`) land after the next
 * notification instead of before it, as the recording had it. A response
 * is rare, so the longer gap costs nothing measurable.
 */
const RESPONSE_GAP_MS = 50;
/** A request that opens or addresses a provider session; see segment release. */
const SESSION_DEFINING_KEY =
  /^(thread|session)\/(start|resume|fork|new|load|archive|unarchive|name\/set)$/;

/**
 * Only the replay flags are read; anything else on argv (the Agent SDK's
 * `--output-format stream-json …` when this plays the Claude CLI) is ignored.
 */
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
    throw new Error("usage: --recording <dir> --dialect <json-rpc|claude-cli> --state <dir>");
  }
  return args;
}

function readLane(dir, direction) {
  const file = join(dir, `${direction}.ndjson`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .map((entry) => ({ ...entry, run: typeof entry.run === "number" ? entry.run : 0 }));
}

// ---------------------------------------------------------------------------
// Dialects: classify a line into request / response / notification
// ---------------------------------------------------------------------------

const DIALECTS = {
  "json-rpc": {
    classify(message) {
      const hasId = typeof message.id === "string" || typeof message.id === "number";
      if (hasId && typeof message.method === "string") {
        return { kind: "request", id: message.id, key: message.method };
      }
      if (hasId) {
        return { kind: "response", id: message.id, key: "response" };
      }
      if (typeof message.method === "string") {
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
        return { kind: "response", id: message.response?.request_id, key: "control_response" };
      }
      return {
        kind: "notification",
        key: `${message.type ?? "?"}${message.subtype ? `:${message.subtype}` : ""}`,
      };
    },
    isInitialize(classified) {
      return classified.kind === "request" && classified.key === "control_request:initialize";
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
};

// ---------------------------------------------------------------------------
// Segments: one per spawned child, cut at each bridge-originated initialize
// ---------------------------------------------------------------------------

function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function buildSegments(entries, dialect) {
  const segments = [];
  let current = null;
  for (const entry of entries) {
    const message = parseLine(entry.line);
    const classified = message === null ? { kind: "raw", key: "raw" } : dialect.classify(message);
    const startsSegment = entry.dir === "bridge→provider" && message !== null && dialect.isInitialize(classified);
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
  } catch {
    // Already gone; nothing to release.
  }
}

/**
 * The harness's pacing cursor: `"<run> <seq>"` (play recorded lines up to and
 * excluding that position), `"end"` (play everything), or absent (play
 * everything — a harness that does not pace).
 */
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
  return entry.run < cursor.run || (entry.run === cursor.run && entry.seq < cursor.seq);
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

// ---------------------------------------------------------------------------
// Claude hook callback ids: the SDK numbers hooks per process; align the
// recorded registration with the live one by event name and position.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function main() {
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
  const log = (text) => process.stderr.write(`[replay-child #${segmentIndex}] ${text}\n`);
  if (script.length === 0) {
    log(`no recorded segment ${segmentIndex} (recording has ${segments.length}); answering generically`);
  }
  const segmentSessionKey = firstSessionDefiningKey(script);
  let sawSessionDefiningRequest = false;
  let cursorWait = null;

  let position = 0;
  const pendingLive = [];
  /** recorded bridge request id → live bridge request id */
  const liveIdByRecordedId = new Map();
  /** recorded bridge request ids this bridge never sent; their responses are dropped */
  const skippedRecordedIds = new Set();
  let hookIds = new Map();
  let stallTimer = null;
  let lookaheadTimer = null;
  let emitTimer = null;

  function emit(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  function emitRecorded(step) {
    const { message, classified } = step;
    if (classified.kind === "response") {
      const liveId = liveIdByRecordedId.get(String(classified.id));
      emit(dialect.withResponseId(message, liveId === undefined ? classified.id : liveId));
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
        request: { ...message.request, callback_id: hookIds.get(message.request.callback_id) },
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
      // A line just went out; the next one waits its gap.
      return;
    }
    while (position < script.length) {
      const step = script[position];
      if (step.dir === "provider→bridge") {
        if (
          step.classified.kind !== "response" &&
          !cursorAllows(readCursor(args.state), step)
        ) {
          // Paced by the harness: the next runtime request comes first. Only
          // spontaneous lines wait; a response answers a request the bridge
          // already made, and holding it would deadlock a child that is
          // replaying a later segment (codex's maintenance child).
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
            // The response to a bridge request the live bridge has not sent yet.
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
      // An expectation of what the bridge writes.
      const live = takeMatchingLive(step);
      if (live === null) {
        return;
      }
      if (step.classified.kind === "request") {
        liveIdByRecordedId.set(String(step.classified.id), live.classified.id);
        if (dialect.isInitialize(step.classified) && args.dialect === "claude-cli") {
          hookIds = hookCallbackIdMap(step.message, live.message);
        }
      }
      position += 1;
    }
  }

  /**
   * A live line that matches no current expectation but does match a later
   * one: this bridge version skipped what the recording has in between. Drop
   * those expectations (and the responses to skipped requests), keep emitting
   * the provider lines in between, and resume at the match.
   */
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
        log(`bridge skipped recorded ${skipped.join(", ")}; resuming at ${live.classified.key}`);
        position = index;
        advance();
        armStall();
        return;
      }
    }
  }

  function answerGenerically(live, reason) {
    if (live.classified.kind === "request") {
      log(`${reason}: answering ${live.classified.key} (${String(live.classified.id)}) generically`);
      emit(dialect.genericResponse(live.classified.id));
    } else {
      log(`${reason}: dropping unmatched ${live.classified.kind} ${live.classified.key}`);
    }
  }

  function onStall() {
    stallTimer = null;
    if (pendingLive.length === 0) return;
    const expected = script[position];
    log(
      `stalled for ${STALL_MS}ms at step ${position}/${script.length}` +
        (expected ? ` (expecting ${expected.dir} ${expected.classified.key})` : ""),
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
    lookaheadTimer = pendingLive.length > 0 ? setTimeout(lookAhead, LOOKAHEAD_MS) : null;
  }

  /**
   * This child is not the one the segment was recorded from: hand the
   * segment back for the next spawn and serve this bridge generically.
   */
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

  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    const message = parseLine(line);
    if (message === null) return;
    const live = { message, classified: dialect.classify(message) };
    if (
      !sawSessionDefiningRequest &&
      live.classified.kind === "request" &&
      SESSION_DEFINING_KEY.test(live.classified.key)
    ) {
      sawSessionDefiningRequest = true;
      if (segmentSessionKey !== null && live.classified.key !== segmentSessionKey) {
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
  });
  lines.on("close", () => {
    process.exit(0);
  });
  process.on("SIGTERM", () => process.exit(0));

  advance();
}

main();
