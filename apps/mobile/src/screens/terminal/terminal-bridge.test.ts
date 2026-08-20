import { TERMINAL_DATA_MAX_BYTES as DOMAIN_TERMINAL_DATA_MAX_BYTES } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  accessoryKeySequence,
  applyControlModifier,
  applyStickyControl,
  canForwardTerminalData,
  createTerminalReplayWriteState,
  createTerminalWriteBatcher,
  decodeTerminalOutputBytes,
  encodeTerminalInputChunks,
  TERMINAL_DATA_MAX_BYTES,
  writeTerminalOutput,
  type TerminalWriteBatch,
  type TerminalWriter,
} from "./terminal-bridge";
import { parseTerminalPageMessage } from "./terminal-page-message";

describe("terminal input encoding", () => {
  it("pins the local wire limit to @bb/domain", () => {
    expect(TERMINAL_DATA_MAX_BYTES).toBe(DOMAIN_TERMINAL_DATA_MAX_BYTES);
  });

  it("splits large paste input at the wire limit without losing UTF-8 bytes", () => {
    const input = `${"a".repeat(TERMINAL_DATA_MAX_BYTES - 1)}🙂tail`;
    const chunks = encodeTerminalInputChunks(input);
    expect(chunks).toHaveLength(2);
    expect(
      chunks.every(
        (chunk) =>
          Buffer.from(chunk, "base64").byteLength <= TERMINAL_DATA_MAX_BYTES,
      ),
    ).toBe(true);
    const decoded = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk, "base64")),
    );
    expect(decoded.toString("utf8")).toBe(input);
  });

  it("round-trips output bytes so a glyph split across chunks survives", () => {
    const encoded = new TextEncoder().encode("🙂");
    const first = decodeTerminalOutputBytes(
      Buffer.from(encoded.subarray(0, 2)).toString("base64"),
    );
    const second = decodeTerminalOutputBytes(
      Buffer.from(encoded.subarray(2)).toString("base64"),
    );
    const decoder = new TextDecoder();
    expect(
      decoder.decode(first, { stream: true }) + decoder.decode(second),
    ).toBe("🙂");
  });
});

describe("accessoryKeySequence", () => {
  const normal = { applicationCursorKeys: false };
  const application = { applicationCursorKeys: true };

  it("sends CSI cursor keys in normal mode and SS3 in application mode", () => {
    expect(accessoryKeySequence("ArrowUp", normal, false)).toBe("\x1b[A");
    expect(accessoryKeySequence("ArrowDown", normal, false)).toBe("\x1b[B");
    expect(accessoryKeySequence("ArrowRight", normal, false)).toBe("\x1b[C");
    expect(accessoryKeySequence("ArrowLeft", normal, false)).toBe("\x1b[D");
    expect(accessoryKeySequence("ArrowUp", application, false)).toBe("\x1bOA");
    expect(accessoryKeySequence("Home", normal, false)).toBe("\x1b[H");
    expect(accessoryKeySequence("End", application, false)).toBe("\x1bOF");
  });

  it("adds the Control modifier parameter regardless of cursor mode", () => {
    expect(accessoryKeySequence("ArrowLeft", application, true)).toBe(
      "\x1b[1;5D",
    );
    expect(accessoryKeySequence("Home", normal, true)).toBe("\x1b[1;5H");
  });

  it("maps Esc, Tab and the punctuation keys", () => {
    expect(accessoryKeySequence("Escape", normal, false)).toBe("\x1b");
    expect(accessoryKeySequence("Tab", normal, true)).toBe("\t");
    expect(accessoryKeySequence("-", normal, false)).toBe("-");
    expect(accessoryKeySequence("/", normal, false)).toBe("/");
    expect(accessoryKeySequence("|", normal, false)).toBe("|");
    expect(accessoryKeySequence("/", normal, true)).toBe("\x1f");
  });
});

describe("sticky Control", () => {
  it("turns letters into C0 controls and leaves non-letters alone", () => {
    expect(applyControlModifier("c")).toBe("\x03");
    expect(applyControlModifier("C")).toBe("\x03");
    expect(applyControlModifier("z")).toBe("\x1a");
    expect(applyControlModifier("[")).toBe("\x1b");
    expect(applyControlModifier(" ")).toBe("\x00");
    expect(applyControlModifier("?")).toBe("\x7f");
    expect(applyControlModifier("1")).toBe("1");
    expect(applyControlModifier("ab")).toBe("ab");
  });

  it("is spent by a single keystroke but not by a paste", () => {
    expect(applyStickyControl("d")).toEqual({ text: "\x04", consumed: true });
    expect(applyStickyControl("1")).toEqual({ text: "1", consumed: true });
    expect(applyStickyControl("\x1b[1;1R")).toEqual({
      text: "\x1b[1;1R",
      consumed: false,
    });
    expect(applyStickyControl("echo hi\n")).toEqual({
      text: "echo hi\n",
      consumed: false,
    });
  });
});

describe("replay write suppression", () => {
  function fakeTerminal(): TerminalWriter & { flush(): void } {
    const callbacks: Array<() => void> = [];
    return {
      write(_data, callback) {
        if (callback) callbacks.push(callback);
      },
      flush() {
        for (const callback of callbacks.splice(0)) callback();
      },
    };
  }

  it("mutes onData while any replayed write is still being parsed", () => {
    const terminal = fakeTerminal();
    const state = createTerminalReplayWriteState();
    writeTerminalOutput({
      terminal,
      data: "\x1b[6n",
      isReplay: true,
      replayWriteState: state,
    });
    writeTerminalOutput({
      terminal,
      data: "more",
      isReplay: true,
      replayWriteState: state,
    });
    expect(canForwardTerminalData(state)).toBe(false);
    // A live write in between does not unmute the replay.
    writeTerminalOutput({
      terminal,
      data: "live",
      isReplay: false,
      replayWriteState: state,
    });
    expect(canForwardTerminalData(state)).toBe(false);
    terminal.flush();
    expect(state.suppressedWriteCount).toBe(0);
    expect(canForwardTerminalData(state)).toBe(true);
  });
});

describe("createTerminalWriteBatcher", () => {
  function harness(maxBytes = 10) {
    const batches: TerminalWriteBatch[] = [];
    const timers: Array<() => void> = [];
    const batcher = createTerminalWriteBatcher({
      flush: (batch) => batches.push(batch),
      maxBytes,
      maxDelayMs: 16,
      setTimeout: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: (handle) => {
        timers[(handle as number) - 1] = () => undefined;
      },
    });
    const fire = () => {
      for (const timer of timers.splice(0)) timer();
    };
    return { batcher, batches, fire, timers };
  }

  it("coalesces chunks until the delay elapses", () => {
    const { batcher, batches, fire, timers } = harness();
    batcher.push("aa", false);
    batcher.push("bb", false);
    expect(batches).toEqual([]);
    expect(timers).toHaveLength(1);
    fire();
    expect(batches).toEqual([{ chunks: ["aa", "bb"], replay: false }]);
  });

  it("flushes early once the batch reaches the byte budget", () => {
    const { batcher, batches, fire } = harness(6);
    batcher.push("aaaa", false);
    expect(batches).toEqual([]);
    batcher.push("bbb", false);
    expect(batches).toEqual([{ chunks: ["aaaa", "bbb"], replay: false }]);
    // The stale timer is cancelled: nothing doubles up.
    fire();
    expect(batches).toHaveLength(1);
  });

  it("never mixes replayed and live output in one batch", () => {
    const { batcher, batches, fire } = harness();
    batcher.push("r1", true);
    batcher.push("r2", true);
    batcher.push("l1", false);
    expect(batches).toEqual([{ chunks: ["r1", "r2"], replay: true }]);
    fire();
    expect(batches[1]).toEqual({ chunks: ["l1"], replay: false });
  });

  it("delivers an oversized chunk on its own and drops everything after dispose", () => {
    const { batcher, batches, fire } = harness(4);
    batcher.push("oversized-chunk", true);
    expect(batches).toEqual([{ chunks: ["oversized-chunk"], replay: true }]);
    batcher.push("x", false);
    batcher.dispose();
    fire();
    batcher.push("y", false);
    expect(batches).toHaveLength(1);
  });

  it("flushNow delivers pending output before a status line", () => {
    const { batcher, batches } = harness();
    batcher.push("a", false);
    batcher.flushNow();
    expect(batches).toEqual([{ chunks: ["a"], replay: false }]);
    batcher.flushNow();
    expect(batches).toHaveLength(1);
  });
});

describe("parseTerminalPageMessage", () => {
  it("accepts the page's messages and rejects junk", () => {
    expect(
      parseTerminalPageMessage(
        JSON.stringify({ type: "ready", cols: 80, rows: 24 }),
      ),
    ).toEqual({ type: "ready", cols: 80, rows: 24 });
    expect(
      parseTerminalPageMessage(
        JSON.stringify({ type: "data", dataBase64: "aGk=" }),
      ),
    ).toEqual({ type: "data", dataBase64: "aGk=" });
    expect(parseTerminalPageMessage("not json")).toBeNull();
    expect(
      parseTerminalPageMessage(JSON.stringify({ type: "nope" })),
    ).toBeNull();
    expect(
      parseTerminalPageMessage(
        JSON.stringify({ type: "resize", cols: 0, rows: 1 }),
      ),
    ).toBeNull();
    expect(
      parseTerminalPageMessage(JSON.stringify({ type: "link", url: "" })),
    ).toBeNull();
  });

  it("only lets http(s) links out of the page", () => {
    expect(
      parseTerminalPageMessage(
        JSON.stringify({ type: "link", url: "https://example.com/x?y=1" }),
      ),
    ).toEqual({ type: "link", url: "https://example.com/x?y=1" });
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "bb://threads/1",
      "example.com",
    ]) {
      expect(
        parseTerminalPageMessage(JSON.stringify({ type: "link", url })),
      ).toBeNull();
    }
  });
});
