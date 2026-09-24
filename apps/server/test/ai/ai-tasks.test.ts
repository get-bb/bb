import { setAiServiceSelection } from "@bb/db";
import { describe, expect, it } from "vitest";
import { createAiServiceRegistry } from "../../src/services/ai/ai-service-registry.js";
import {
  isAiTaskAvailable,
  runTextAiTask,
} from "../../src/services/ai/ai-tasks.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { withTestHarness } from "../helpers/test-app.js";

const PROMPT = "Write a title for: fix the flaky login test";

describe("AI task routing", () => {
  it("walks the builtin Automatic chain in order and takes the first answer", async () => {
    await withTestHarness({}, async (harness) => {
      const cloud = registerFakeAiService(harness.deps.aiServices, {
        id: "bb",
        pluginId: "bb-ai",
        builtin: true,
        complete: async () => "Cloud title",
      });
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: async () => "Codex title",
      });

      const outcome = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: PROMPT,
      });

      expect(outcome).toMatchObject({ ok: true, value: "Codex title" });
      expect(codex.completeCalls.map((call) => call.prompt)).toEqual([PROMPT]);
      expect(cloud.completeCalls).toEqual([]);
    });
  });

  it("moves to the next Automatic service when one rejects or is not ready", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        status: async () => ({ ready: false, message: "Sign in to Codex" }),
      });
      registerFakeAiService(harness.deps.aiServices, {
        id: "bb",
        pluginId: "bb-ai",
        builtin: true,
        complete: async () => {
          throw new Error("upstream down");
        },
      });
      await harness.deps.aiServices.status({
        pluginId: "provider-codex",
        serviceId: "codex",
      });

      const failed = await runTextAiTask(harness.deps, {
        task: "commit-message",
        label: "test",
        prompt: PROMPT,
      });
      expect(codex.completeCalls).toEqual([]);
      expect(failed).toMatchObject({
        ok: false,
        reason: "failed",
        message: "Fake AI: upstream down",
      });
    });
  });

  it("rechecks a stale not-ready status before skipping the service", async () => {
    await withTestHarness({}, async (harness) => {
      let clock = 0;
      let signedIn = false;
      const deps = {
        ...harness.deps,
        aiServices: createAiServiceRegistry({ now: () => clock }),
      };
      const codex = registerFakeAiService(deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: async () => "Codex title",
        status: async () =>
          signedIn ? { ready: true } : { ready: false, message: "Sign in" },
      });
      await deps.aiServices.status({
        pluginId: "provider-codex",
        serviceId: "codex",
      });
      signedIn = true;

      await expect(
        runTextAiTask(deps, {
          task: "thread-title",
          label: "test",
          prompt: PROMPT,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "unavailable" });
      expect(codex.completeCalls).toEqual([]);

      clock += 10_001;
      await expect(
        runTextAiTask(deps, {
          task: "thread-title",
          label: "test",
          prompt: PROMPT,
        }),
      ).resolves.toMatchObject({ ok: true, value: "Codex title" });
      expect(codex.completeCalls).toHaveLength(1);
    });
  });

  it("skips a cancelled request without calling a service", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        runTextAiTask(harness.deps, {
          task: "thread-title",
          label: "test",
          prompt: PROMPT,
          signal: controller.signal,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "cancelled" });
      expect(codex.completeCalls).toEqual([]);
    });
  });

  it("serves a selection from the plugin it names when two plugins share an id", async () => {
    await withTestHarness({}, async (harness) => {
      const first = registerFakeAiService(harness.deps.aiServices, {
        id: "helper",
        pluginId: "first-plugin",
        complete: async () => "First title",
      });
      const second = registerFakeAiService(harness.deps.aiServices, {
        id: "helper",
        pluginId: "second-plugin",
        complete: async () => "Second title",
      });
      setAiServiceSelection(harness.deps.db, "thread-title", {
        mode: "service",
        pluginId: "second-plugin",
        serviceId: "helper",
      });

      await expect(
        runTextAiTask(harness.deps, {
          task: "thread-title",
          label: "test",
          prompt: PROMPT,
        }),
      ).resolves.toMatchObject({ ok: true, value: "Second title" });
      expect(first.completeCalls).toEqual([]);
      expect(second.completeCalls).toHaveLength(1);
    });
  });

  it("never sends Automatic traffic to a third-party plugin", async () => {
    await withTestHarness({}, async (harness) => {
      const impostor = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: false,
      });
      const other = registerFakeAiService(harness.deps.aiServices, {
        id: "my-openrouter",
        pluginId: "my-openrouter",
      });

      const outcome = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: PROMPT,
      });

      expect(outcome).toMatchObject({ ok: false, reason: "unavailable" });
      expect(impostor.completeCalls).toEqual([]);
      expect(other.completeCalls).toEqual([]);
    });
  });

  it("uses only an explicitly selected service and never falls through", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
      });
      const mine = registerFakeAiService(harness.deps.aiServices, {
        id: "my-openrouter",
        pluginId: "my-openrouter",
        complete: async () => {
          throw new Error("bad key");
        },
      });
      setAiServiceSelection(harness.deps.db, "commit-message", {
        mode: "service",
        pluginId: "my-openrouter",
        serviceId: "my-openrouter",
      });

      const outcome = await runTextAiTask(harness.deps, {
        task: "commit-message",
        label: "test",
        prompt: PROMPT,
      });

      expect(outcome).toMatchObject({ ok: false, reason: "failed" });
      expect(mine.completeCalls).toHaveLength(1);
      expect(codex.completeCalls).toEqual([]);

      const title = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: PROMPT,
      });
      expect(title).toMatchObject({ ok: true, value: "Fake reply" });
      expect(codex.completeCalls).toHaveLength(1);
    });
  });

  it("treats a selection whose plugin id no longer matches as unavailable", async () => {
    await withTestHarness({}, async (harness) => {
      const other = registerFakeAiService(harness.deps.aiServices, {
        id: "my-openrouter",
        pluginId: "someone-else",
      });
      setAiServiceSelection(harness.deps.db, "thread-title", {
        mode: "service",
        pluginId: "my-openrouter",
        serviceId: "my-openrouter",
      });

      const outcome = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: PROMPT,
      });

      expect(outcome).toMatchObject({ ok: false, reason: "unavailable" });
      expect(other.completeCalls).toEqual([]);
    });
  });

  it("does nothing when the task is turned off", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
      });
      setAiServiceSelection(harness.deps.db, "thread-title", { mode: "off" });

      const outcome = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: PROMPT,
      });

      expect(outcome).toMatchObject({ ok: false, reason: "off" });
      expect(codex.completeCalls).toEqual([]);
    });
  });

  it("aborts a service that outlives the task timeout", async () => {
    await withTestHarness({}, async (harness) => {
      let aborted = false;
      registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: (_prompt, { signal }) =>
          new Promise<string>(() => {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
          }),
      });

      const outcome = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: PROMPT,
        timeoutMs: 20,
      });

      expect(outcome).toMatchObject({ ok: false, reason: "timeout" });
      expect(aborted).toBe(true);
    });
  });

  it("cleans replies and treats an empty reply as a failure", async () => {
    await withTestHarness({}, async (harness) => {
      const replies = ["<think>hmm</think>", 'Title: "Fix flaky login test"'];
      registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: async () => replies.shift() ?? "",
      });

      await expect(
        runTextAiTask(harness.deps, {
          task: "thread-title",
          label: "test",
          prompt: PROMPT,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "failed" });
      await expect(
        runTextAiTask(harness.deps, {
          task: "thread-title",
          label: "test",
          prompt: PROMPT,
        }),
      ).resolves.toMatchObject({ ok: true, value: "Fix flaky login test" });
    });
  });

  it("reports a task available only once a candidate's status is known and ready", async () => {
    await withTestHarness({}, async (harness) => {
      registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        transcribe: async () => "hello",
        status: async () => ({ ready: true }),
      });
      registerFakeAiService(harness.deps.aiServices, {
        id: "bb",
        pluginId: "bb-ai",
        builtin: true,
        complete: null,
        transcribe: async () => "hello",
        status: async () => ({ ready: false, message: "Signed out" }),
      });

      expect(isAiTaskAvailable(harness.deps, "voice")).toBe(false);
      await harness.deps.aiServices.status({
        pluginId: "provider-codex",
        serviceId: "codex",
      });
      await harness.deps.aiServices.status({
        pluginId: "bb-ai",
        serviceId: "bb",
      });
      expect(isAiTaskAvailable(harness.deps, "voice")).toBe(true);

      setAiServiceSelection(harness.deps.db, "voice", {
        mode: "service",
        pluginId: "bb-ai",
        serviceId: "bb",
      });
      expect(isAiTaskAvailable(harness.deps, "voice")).toBe(false);
    });
  });
});
