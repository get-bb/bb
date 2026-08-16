import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  experimental_defineHostEntry,
  experimental_defineHostRpcContract,
} from "../../index.js";
import { experimental_createHostEntryHarness } from "../host.js";

const contract = experimental_defineHostRpcContract({
  methods: {
    inspectHost: {
      target: { kind: "host" },
      input: z.object({ value: z.string() }).strict(),
      output: z
        .object({
          cwd: z.null(),
          dataDir: z.string(),
          hostId: z.string(),
          value: z.string(),
        })
        .strict(),
    },
    inspectEnvironment: {
      target: { kind: "environment", scheduling: "shared" },
      input: z.object({}).strict(),
      output: z
        .object({
          cwd: z.string(),
          environmentId: z.string(),
          hostId: z.string(),
        })
        .strict(),
    },
    wait: {
      target: { kind: "host" },
      input: z.object({}).strict(),
      output: z.object({ aborted: z.boolean() }).strict(),
    },
    publish: {
      target: { kind: "environment", scheduling: "shared" },
      input: z.object({ count: z.number().int() }).strict(),
      output: z.object({}).strict(),
    },
    large: {
      target: { kind: "host" },
      input: z.object({}).strict(),
      output: z.string(),
    },
  },
  signals: {
    changed: {
      target: "environment",
      payload: z.object({ count: z.number().int().positive() }).strict(),
    },
  },
});

function createEntry(dispose = vi.fn()) {
  return experimental_defineHostEntry({
    contract,
    handlers: {
      inspectHost(input, context) {
        if (context.target.kind !== "host" || context.cwd !== null) {
          throw new Error("unexpected target");
        }
        return {
          cwd: context.cwd,
          dataDir: context.paths.dataDir,
          hostId: context.target.hostId,
          value: input.value,
        };
      },
      inspectEnvironment(_input, context) {
        if (context.target.kind !== "environment" || context.cwd === null) {
          throw new Error("unexpected target");
        }
        return {
          cwd: context.cwd,
          environmentId: context.target.environmentId,
          hostId: context.target.hostId,
        };
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
      publish(input, context) {
        context.signals.publish("changed", input);
        return {};
      },
      large() {
        return "x".repeat(8 * 1024 * 1024);
      },
    },
    dispose,
  });
}

describe("experimental_createHostEntryHarness", () => {
  it("resolves daemon-shaped host and environment contexts", async () => {
    const harness = experimental_createHostEntryHarness(createEntry(), {
      hostId: "host-environment",
      paths: { dataDir: "/plugin/data", tempDir: "/plugin/temp" },
      resolveEnvironmentCwd: async (environmentId) =>
        environmentId === "env-1" ? "/work/env-1" : null,
    });

    await expect(
      harness.experimental_call(
        "inspectHost",
        { value: "hello" },
        { target: { hostId: "host-direct" } },
      ),
    ).resolves.toEqual({
      cwd: null,
      dataDir: "/plugin/data",
      hostId: "host-direct",
      value: "hello",
    });
    await expect(
      harness.experimental_call(
        "inspectEnvironment",
        {},
        { target: { environmentId: "env-1" } },
      ),
    ).resolves.toEqual({
      cwd: "/work/env-1",
      environmentId: "env-1",
      hostId: "host-environment",
    });
  });

  it("validates inputs, targets, workspace resolution, and output size", async () => {
    const harness = experimental_createHostEntryHarness(createEntry());

    await expect(
      harness.experimental_call(
        "inspectHost",
        // @ts-expect-error Runtime validation is the behavior under test.
        { value: 42 },
        { target: { hostId: "host-1" } },
      ),
    ).rejects.toThrow();
    await expect(
      harness.experimental_call(
        "inspectEnvironment",
        {},
        { target: { environmentId: "missing" } },
      ),
    ).rejects.toThrow(/no workspace is configured/u);
    await expect(
      harness.experimental_call(
        "inspectEnvironment",
        {},
        // @ts-expect-error Runtime target enforcement is the behavior under test.
        { target: { hostId: "wrong-kind" } },
      ),
    ).rejects.toThrow(/requires an environment target/u);
    await expect(
      harness.experimental_call("large", {}, { target: { hostId: "host-1" } }),
    ).rejects.toThrow(/exceeds 8388608 bytes/u);
    await expect(
      harness.experimental_call(
        "inspectHost",
        { value: "x".repeat(8 * 1024 * 1024) },
        { target: { hostId: "host-1" } },
      ),
    ).rejects.toThrow(/host rpc input exceeds 8388608 bytes/u);
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
    const transformingContract = experimental_defineHostRpcContract({
      methods: {
        roundTrip: {
          target: { kind: "host" },
          input: z.object({ when: inputDate }).strict(),
          output: outputDate,
        },
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

    const result = await harness.experimental_call(
      "roundTrip",
      { when: iso },
      { target: { hostId: "host-1" } },
    );

    expect(result).toEqual(new Date(iso));
    expect(inputValidations).toBe(2);
    expect(outputValidations).toBe(2);
  });

  it("captures validated typed signals with their resolved target", async () => {
    const harness = experimental_createHostEntryHarness(createEntry(), {
      hostId: "host-1",
      resolveEnvironmentCwd: () => "/work/env-1",
    });

    await harness.experimental_call(
      "publish",
      { count: 2 },
      { target: { environmentId: "env-1" } },
    );

    await expect(harness.experimental_getSignals()).resolves.toEqual([
      {
        signal: "changed",
        payload: { count: 2 },
        target: {
          kind: "environment",
          environmentId: "env-1",
          hostId: "host-1",
        },
      },
    ]);
  });

  it("surfaces invalid signal payloads", async () => {
    const harness = experimental_createHostEntryHarness(createEntry(), {
      resolveEnvironmentCwd: () => "/work/env-1",
    });

    await harness.experimental_call(
      "publish",
      { count: -1 },
      { target: { environmentId: "env-1" } },
    );
    await expect(harness.experimental_getSignals()).rejects.toThrow();
  });

  it("propagates request and generation cancellation and disposes once", async () => {
    const dispose = vi.fn();
    const harness = experimental_createHostEntryHarness(createEntry(dispose));
    const requestController = new AbortController();
    const request = harness.experimental_call(
      "wait",
      {},
      {
        target: { hostId: "host-1" },
        signal: requestController.signal,
      },
    );
    requestController.abort();
    await expect(request).resolves.toEqual({ aborted: true });

    const lifecycleRequest = harness.experimental_call(
      "wait",
      {},
      { target: { hostId: "host-1" } },
    );
    await Promise.all([
      harness.experimental_dispose(),
      harness.experimental_dispose(),
    ]);
    await expect(lifecycleRequest).resolves.toEqual({ aborted: true });
    expect(harness.experimental_lifecycleSignal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    await expect(
      harness.experimental_call(
        "inspectHost",
        { value: "late" },
        { target: { hostId: "host-1" } },
      ),
    ).rejects.toThrow(/harness is disposed/u);
  });
});
