import { setTimeout as delay } from "node:timers/promises";
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  InferenceTimeoutError,
  inferenceComplete,
} from "../../src/services/ai/inference.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const titleSchema = Type.Object({
  title: Type.String(),
});
describe("inferenceComplete", () => {
  it("surfaces missing host for codex inference", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.6-luna",
    }, async (harness) => {
      await expect(
        inferenceComplete(harness.deps, {
          prompt: "Generate a title",
          schema: titleSchema,
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({
        body: {
          code: "host_unavailable",
        },
        status: 502,
      });
    });
  });

  it("routes codex inference through the host daemon and validates structured output", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.6-luna",
    }, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      expect(queued.row.hostId).toBe(host.id);
      expect(queued.command).toMatchObject({
        type: "codex.inference.complete",
        model: "gpt-5.6-luna",
        reasoningEffort: "none",
        prompt: "Generate a title",
        timeoutMs: 5000,
      });

      await reportQueuedCommandSuccess(harness, queued, {
        model: "gpt-5.6-luna",
        value: { title: "Generated title" },
      });

      await expect(completion).resolves.toEqual({
        title: "Generated title",
      });
    });
  });

  it("routes an explicit fallback model instead of the configured primary", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.6-luna",
    }, async (harness) => {
      seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        model: "codex/gpt-5.4-mini",
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      expect(queued.command).toMatchObject({
        model: "gpt-5.4-mini",
        type: "codex.inference.complete",
      });

      await reportQueuedCommandSuccess(harness, queued, {
        model: "gpt-5.4-mini",
        value: { title: "Fallback title" },
      });

      await expect(completion).resolves.toEqual({ title: "Fallback title" });
    });
  });

  it("leaves grace for a daemon result to cross the host RPC boundary", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.6-luna",
    }, async (harness) => {
      seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      await delay(20);
      await reportQueuedCommandSuccess(harness, queued, {
        model: "gpt-5.6-luna",
        value: { title: "Generated title" },
      });

      await expect(completion).resolves.toEqual({
        title: "Generated title",
      });
    });
  });

  it("converts codex daemon timeouts into inference timeouts", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.6-luna",
    }, async (harness) => {
      seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      const completionExpectation =
        expect(completion).rejects.toBeInstanceOf(InferenceTimeoutError);
      await reportQueuedCommandError(harness, queued, {
        errorCode: "codex_request_timeout",
        errorMessage: "Codex request timed out after 5000ms",
      });

      await completionExpectation;
    });
  });

  it("surfaces codex daemon auth errors", async () => {
    await withTestHarness({
      inferenceModel: "codex/gpt-5.6-luna",
    }, async (harness) => {
      seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      const completionExpectation = expect(completion).rejects.toMatchObject({
        body: {
          code: "codex_auth_missing",
        },
        status: 502,
      });
      await reportQueuedCommandError(harness, queued, {
        errorCode: "codex_auth_missing",
        errorMessage: "Codex auth file not found",
      });

      await completionExpectation;
    });
  });
});
