import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDescriptionSaver,
  type DescriptionSaveOutcome,
} from "./description-save.js";

const DELAY_MS = 800;

function setup(
  save: (taskId: string, markdown: string) => Promise<DescriptionSaveOutcome>,
) {
  const errors: string[] = [];
  const saver = createDescriptionSaver({
    save,
    onError: (message) => errors.push(message),
    delayMs: DELAY_MS,
  });
  return { errors, saver };
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDescriptionSaver", () => {
  it("clears the pending draft only after the server confirms the save", async () => {
    const calls: string[] = [];
    const { errors, saver } = setup(async (_taskId, markdown) => {
      calls.push(markdown);
      return { ok: true };
    });

    saver.onChange("task-1", "draft v1");
    expect(saver.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS - 1);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["draft v1"]);
    expect(saver.hasPending()).toBe(false);
    expect(errors).toEqual([]);
    saver.flush("task-1");
    await flushMicrotasks();
    expect(calls).toEqual(["draft v1"]);
  });

  it("keeps the draft after a transport failure so the unmount flush retries", async () => {
    const calls: string[] = [];
    let fail = true;
    const { errors, saver } = setup(async (_taskId, markdown) => {
      calls.push(markdown);
      if (fail) throw new Error("network down");
      return { ok: true };
    });

    saver.onChange("task-1", "draft v1");
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(errors).toEqual(["network down"]);
    expect(saver.hasPending()).toBe(true);

    fail = false;
    saver.flush("task-1");
    await flushMicrotasks();
    expect(calls).toEqual(["draft v1", "draft v1"]);
    expect(saver.hasPending()).toBe(false);
  });

  it("does not clear a newer draft typed while a save is in flight", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const { saver } = setup(async (_taskId, markdown) => {
      calls.push(markdown);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true };
    });

    saver.onChange("task-1", "draft v1");
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    saver.onChange("task-1", "draft v2");
    release?.();
    await flushMicrotasks();
    expect(saver.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    release?.();
    await flushMicrotasks();
    expect(calls).toEqual(["draft v1", "draft v2"]);
  });

  it("only flushes drafts belonging to the flushed task", async () => {
    const calls: Array<[string, string]> = [];
    const { saver } = setup(async (taskId, markdown) => {
      calls.push([taskId, markdown]);
      return { ok: true };
    });
    saver.onChange("task-2", "other task draft");
    saver.flush("task-1");
    await flushMicrotasks();
    expect(calls).toEqual([]);
    expect(saver.hasPending()).toBe(true);
  });
});
