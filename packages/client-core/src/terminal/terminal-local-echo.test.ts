import { describe, expect, it } from "vitest";
import { TerminalLocalEchoEngine } from "./terminal-local-echo.js";

const bytes = (text: string) => new TextEncoder().encode(text);

const write = (text: string) => ({
  type: "write" as const,
  bytes: bytes(text),
});

const writeBytes = (value: Uint8Array) => ({
  type: "write" as const,
  bytes: value,
});

function readyEngine() {
  const engine = new TerminalLocalEchoEngine();
  engine.setEnabled(true);
  engine.setRoundTripMs(80);
  return engine;
}

function confirmFirstEcho(engine: TerminalLocalEchoEngine) {
  const first = engine.onUserInput(bytes("p"), { column: 0, row: 0 });
  expect(first?.display).toBe(false);
  expect(engine.reconcile(bytes("p"))).toEqual({
    parts: [write("p")],
    rolledBack: [],
  });
}

describe("TerminalLocalEchoEngine", () => {
  it("keeps password input invisible after an echo-off prompt, even after a prior echo", () => {
    const engine = readyEngine();
    confirmFirstEcho(engine);
    engine.reconcile(bytes("Password:"));
    for (let column = 0; column < 5; column++) {
      expect(engine.onUserInput(bytes("a"), { column, row: 0 })?.display).toBe(
        false,
      );
    }
    expect(engine.onUserInput(bytes("\r"), { column: 5, row: 0 })).toBeNull();
    expect(engine.reconcile(bytes("")).parts).toEqual([]);
  });

  it("passes through the first real echo and predicts the next key immediately", () => {
    const engine = readyEngine();
    confirmFirstEcho(engine);
    const prediction = engine.onUserInput(bytes("é"), { column: 1, row: 0 });
    expect(prediction?.display).toBe(true);
    expect(engine.reconcile(bytes("é"))).toEqual({
      parts: [{ type: "confirm", prediction }],
      rolledBack: [],
    });
  });

  it("passes tentative echoes through while stripping later displayed echoes in the same chunk", () => {
    const engine = readyEngine();
    const a = engine.onUserInput(bytes("a"), { column: 0, row: 0 });
    const b = engine.onUserInput(bytes("b"), { column: 1, row: 0 });
    expect([a?.display, b?.display]).toEqual([false, false]);
    expect(engine.reconcile(bytes("a"))).toEqual({
      parts: [write("a")],
      rolledBack: [],
    });
    const c = engine.onUserInput(bytes("c"), { column: 2, row: 0 });
    expect(c?.display).toBe(true);
    expect(engine.reconcile(bytes("bc"))).toEqual({
      parts: [write("b"), { type: "confirm", prediction: c }],
      rolledBack: [],
    });
    expect(engine.onUserInput(bytes("d"), { column: 3, row: 0 })?.display).toBe(
      true,
    );
  });

  it("keeps output ordered around displayed confirmations", () => {
    const engine = readyEngine();
    confirmFirstEcho(engine);
    const a = engine.onUserInput(bytes("a"), { column: 1, row: 0 });
    expect(a?.display).toBe(true);
    expect(engine.reconcile(bytes("ab"))).toEqual({
      parts: [{ type: "confirm", prediction: a }, write("b")],
      rolledBack: [],
    });
  });

  it("keeps mismatch output after a confirmed displayed prefix", () => {
    const engine = readyEngine();
    confirmFirstEcho(engine);
    const x = engine.onUserInput(bytes("x"), { column: 1, row: 0 });
    const y = engine.onUserInput(bytes("y"), { column: 2, row: 0 });
    expect([x?.display, y?.display]).toEqual([true, true]);
    expect(engine.reconcile(bytes("xq"))).toEqual({
      parts: [{ type: "confirm", prediction: x }, write("q")],
      rolledBack: [y],
    });
  });

  it("restores withheld UTF-8 bytes on mismatch and starts a tentative epoch", () => {
    const engine = readyEngine();
    confirmFirstEcho(engine);
    const prediction = engine.onUserInput(bytes("é"), { column: 1, row: 0 });
    expect(engine.reconcile(bytes("é").subarray(0, 1))).toEqual({
      parts: [],
      rolledBack: [],
    });
    expect(engine.reconcile(bytes("x"))).toEqual({
      parts: [writeBytes(bytes("é").subarray(0, 1)), write("x")],
      rolledBack: [prediction],
    });
    expect(engine.onUserInput(bytes("a"), { column: 1, row: 0 })?.display).toBe(
      false,
    );
  });

  it("rolls back on different output, escape sequences, and newlines", () => {
    for (const output of ["x", "\x1b[31m", "\n"]) {
      const engine = readyEngine();
      confirmFirstEcho(engine);
      const prediction = engine.onUserInput(bytes("a"), { column: 1, row: 0 });
      expect(engine.reconcile(bytes(output))).toEqual({
        parts: [write(output)],
        rolledBack: [prediction],
      });
      expect(
        engine.onUserInput(bytes("b"), { column: 1, row: 0 })?.display,
      ).toBe(false);
    }
  });

  it("waits for RTT, ignores the alternate screen, and restarts after controls", () => {
    const engine = readyEngine();
    const cursor = { column: 0, row: 0 };
    engine.setRoundTripMs(29);
    expect(engine.onUserInput(bytes("a"), cursor)).toBeNull();
    engine.setRoundTripMs(80);
    confirmFirstEcho(engine);
    engine.setAltScreen(true);
    expect(engine.onUserInput(bytes("a"), cursor)).toBeNull();
    engine.setAltScreen(false);
    expect(engine.onUserInput(bytes("a"), cursor)?.display).toBe(false);
    for (const control of ["\b", "\t", "\r", "\x1b[A"]) {
      expect(engine.onUserInput(bytes(control), cursor)).toBeNull();
      expect(engine.onUserInput(bytes("a"), cursor)).toBeNull();
      engine.reconcile(bytes(""));
      expect(engine.onUserInput(bytes("a"), cursor)).toBeNull();
      engine.reconcile(bytes("x"));
      expect(engine.onUserInput(bytes("a"), cursor)?.display).toBe(false);
    }
  });

  it("stops at 64 pending characters", () => {
    const engine = readyEngine();
    for (let column = 0; column < 64; column++) {
      expect(engine.onUserInput(bytes("a"), { column, row: 0 })).not.toBeNull();
    }
    expect(engine.onUserInput(bytes("a"), { column: 64, row: 0 })).toBeNull();
  });
});
