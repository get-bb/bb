import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineRpcContract,
  experimental_defineHostEntry,
} from "../../index.js";
import { experimental_createHostEntryHarness } from "../host.js";

const contract = defineRpcContract({
  echo: {
    input: z.object({ value: z.string() }).strict(),
    output: z.object({ value: z.string() }).strict(),
  },
  wait: {
    input: z.object({}).strict(),
    output: z.object({ aborted: z.boolean() }).strict(),
  },
  large: {
    input: z.object({}).strict(),
    output: z.string(),
  },
});

function createEntry(dispose = vi.fn()) {
  return experimental_defineHostEntry({
    contract,
    handlers: {
      echo(input) {
        return input;
      },
      wait(_input, context) {
        return new Promise((resolve) => {
          if (context.signal.aborted) {
            resolve({ aborted: true });
            return;
          }
          context.signal.addEventListener(
            "abort",
            () => resolve({ aborted: true }),
            { once: true },
          );
        });
      },
      large() {
        return "x".repeat(8 * 1024 * 1024);
      },
    },
    dispose,
  });
}

describe("experimental_createHostEntryHarness", () => {
  it("validates input and bounds JSON output", async () => {
    const harness = experimental_createHostEntryHarness(createEntry());

    await expect(
      harness.experimental_call(
        "echo",
        // @ts-expect-error Runtime validation is the behavior under test.
        { value: 42 },
      ),
    ).rejects.toThrow();
    await expect(harness.experimental_call("large", {})).rejects.toThrow(
      /exceeds 8388608 bytes/u,
    );
  });

  it("mirrors schema transformations on both sides of the JSON wire", async () => {
    let inputValidations = 0;
    let outputValidations = 0;
    const inputDate = z.string().transform((value) => {
      inputValidations += 1;
      return new Date(value);
    });
    const outputDate = z.string().transform((value) => {
      outputValidations += 1;
      return new Date(value);
    });
    const transformingContract = defineRpcContract({
      roundTrip: {
        input: z.object({ when: inputDate }).strict(),
        output: outputDate,
      },
    });
    const harness = experimental_createHostEntryHarness(
      experimental_defineHostEntry({
        contract: transformingContract,
        handlers: {
          roundTrip(input) {
            expect(input.when).toBeInstanceOf(Date);
            return input.when.toISOString();
          },
        },
      }),
    );
    const iso = "2026-08-16T12:34:56.000Z";

    await expect(
      harness.experimental_call("roundTrip", { when: iso }),
    ).resolves.toEqual(new Date(iso));
    expect(inputValidations).toBe(2);
    expect(outputValidations).toBe(2);
  });

  it("propagates request and generation cancellation and disposes once", async () => {
    const dispose = vi.fn();
    const harness = experimental_createHostEntryHarness(createEntry(dispose));
    const requestController = new AbortController();
    const request = harness.experimental_call("wait", {}, {
      signal: requestController.signal,
    });
    requestController.abort();
    await expect(request).resolves.toEqual({ aborted: true });

    const lifecycleRequest = harness.experimental_call("wait", {});
    await Promise.all([
      harness.experimental_dispose(),
      harness.experimental_dispose(),
    ]);
    await expect(lifecycleRequest).resolves.toEqual({ aborted: true });
    expect(harness.experimental_lifecycleSignal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    await expect(
      harness.experimental_call("echo", { value: "late" }),
    ).rejects.toThrow(/harness is disposed/u);
  });
});
