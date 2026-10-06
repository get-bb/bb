import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_RECONNECT_BASE_DELAY_MS,
  ReconnectBackoff,
} from "../src/reconnect.js";
import { humanizeTransportError } from "../src/humanize.js";

const AT_CEILING = { random: () => 1 };

describe("ReconnectBackoff", () => {
  it("grows exponentially and caps at max", () => {
    const backoff = new ReconnectBackoff(AT_CEILING);
    expect(backoff.nextDelayAfterClose(0)).toBe(
      DEFAULT_RECONNECT_BASE_DELAY_MS * 2,
    );
    expect(backoff.nextDelayAfterClose(0)).toBe(
      DEFAULT_RECONNECT_BASE_DELAY_MS * 4,
    );
    expect(backoff.nextDelayAfterClose(0)).toBe(
      DEFAULT_RECONNECT_BASE_DELAY_MS * 8,
    );
    let delay = 0;
    for (let i = 0; i < 20; i++) {
      delay = backoff.nextDelayAfterClose(0);
    }
    expect(delay).toBe(DEFAULT_MAX_RECONNECT_DELAY_MS);
  });

  it("resets attempt after a stable connection", () => {
    const backoff = new ReconnectBackoff({
      ...AT_CEILING,
      stableConnectionMs: 10_000,
    });
    expect(backoff.nextDelayAfterClose(0)).toBe(2_000);
    expect(backoff.nextDelayAfterClose(10_001)).toBe(1_000);
  });

  it("does not reset at exactly the stable threshold", () => {
    const backoff = new ReconnectBackoff({
      ...AT_CEILING,
      stableConnectionMs: 10_000,
    });
    expect(backoff.nextDelayAfterClose(0)).toBe(2_000);
    expect(backoff.nextDelayAfterClose(10_000)).toBe(4_000);
  });

  it("reset() clears the attempt counter", () => {
    const backoff = new ReconnectBackoff(AT_CEILING);
    backoff.nextDelayAfterClose(0);
    backoff.nextDelayAfterClose(0);
    backoff.reset();
    expect(backoff.nextDelayAfterClose(0)).toBe(2_000);
  });

  it("jitters each delay down to half its ceiling", () => {
    const backoff = new ReconnectBackoff({ random: () => 0 });
    expect(backoff.nextDelayAfterClose(20_000)).toBe(500);
    expect(backoff.nextDelayAfterClose(0)).toBe(1_000);
    for (let i = 0; i < 20; i++) backoff.nextDelayAfterClose(0);
    expect(backoff.nextDelayAfterClose(0)).toBe(
      DEFAULT_MAX_RECONNECT_DELAY_MS / 2,
    );
  });

  it("spreads a fleet's first redial after a shared drop", () => {
    const delays = Array.from({ length: 200 }, () =>
      new ReconnectBackoff().nextDelayAfterClose(20_000),
    );
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(DEFAULT_RECONNECT_BASE_DELAY_MS / 2);
      expect(delay).toBeLessThanOrEqual(DEFAULT_RECONNECT_BASE_DELAY_MS);
    }
    expect(new Set(delays).size).toBeGreaterThan(50);
  });
});

describe("humanizeTransportError", () => {
  it("maps known errno codes to short reasons", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    expect(humanizeTransportError(refused, "getbb.app")).toBe(
      "can't reach getbb.app — connection refused",
    );
  });

  it("falls back to the raw message for unknown failures", () => {
    expect(humanizeTransportError(new Error("boom"), "host.example")).toBe(
      "can't reach host.example — boom",
    );
  });
});
