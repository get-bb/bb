import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/errors.js";
import { AgentError, AgentInterrupted } from "../src/worker-contract.js";

function retryableError(message: string): AgentError {
  return new AgentError({
    provider: "codex",
    code: "overloaded",
    message,
    retryable: true,
  });
}

describe("AgentError classification", () => {
  it("defaults to non-retryable", () => {
    const error = new AgentError({
      provider: "claude-code",
      code: "max_turns",
      message: "boom",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AgentError");
    expect(error.provider).toBe("claude-code");
    expect(error.code).toBe("max_turns");
    expect(error.retryable).toBe(false);
  });

  it("carries an explicit retryable flag", () => {
    expect(retryableError("overloaded").retryable).toBe(true);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries retryable AgentErrors with 1s/2s exponential backoff and resolves", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(retryableError("first"))
      .mockRejectedValueOnce(retryableError("second"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // first backoff: 1000ms
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // second backoff: 2000ms
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(promise).resolves.toBe("ok");
  });

  it("gives up after 4 attempts and rethrows the last error", async () => {
    let attempt = 0;
    const fn = vi.fn<() => Promise<string>>(async () => {
      attempt += 1;
      throw retryableError(`attempt-${attempt}`);
    });

    const promise = withRetry(fn, { signal: new AbortController().signal });
    const rejection = expect(promise).rejects.toThrow("attempt-4");
    await vi.advanceTimersByTimeAsync(7_000); // 1s + 2s + 4s of backoff
    await rejection;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("caps the backoff delay at maxMs", async () => {
    const fn = vi.fn<() => Promise<string>>(async () => {
      throw retryableError("always");
    });

    const promise = withRetry(fn, {
      signal: new AbortController().signal,
      attempts: 3,
      baseMs: 100,
      maxMs: 150,
    });
    const rejection = expect(promise).rejects.toThrow("always");

    await vi.advanceTimersByTimeAsync(100); // first backoff: min(150, 100)
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(149); // uncapped would be 200ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // second backoff: min(150, 200) = 150
    expect(fn).toHaveBeenCalledTimes(3);
    await rejection;
  });

  it("rethrows a non-retryable AgentError immediately", async () => {
    const error = new AgentError({
      provider: "codex",
      code: "context_window",
      message: "too big",
    });
    const fn = vi.fn<() => Promise<string>>(async () => {
      throw error;
    });

    await expect(
      withRetry(fn, { signal: new AbortController().signal }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries AgentInterrupted", async () => {
    const fn = vi.fn<() => Promise<string>>(async () => {
      throw new AgentInterrupted();
    });

    await expect(
      withRetry(fn, { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(AgentInterrupted);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries plain errors", async () => {
    const error = new Error("not provider-shaped");
    const fn = vi.fn<() => Promise<string>>(async () => {
      throw error;
    });

    await expect(
      withRetry(fn, { signal: new AbortController().signal }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws AgentInterrupted without calling fn when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn<() => Promise<string>>(async () => "never");

    await expect(
      withRetry(fn, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AgentInterrupted);
    expect(fn).not.toHaveBeenCalled();
  });

  it("aborting during a backoff sleep rejects with AgentInterrupted and clears the timer", async () => {
    const controller = new AbortController();
    const fn = vi.fn<() => Promise<string>>(async () => {
      throw retryableError("again");
    });

    const promise = withRetry(fn, { signal: controller.signal });
    const rejection = expect(promise).rejects.toBeInstanceOf(AgentInterrupted);
    await vi.advanceTimersByTimeAsync(0); // first attempt failed; backoff scheduled
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await rejection;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
