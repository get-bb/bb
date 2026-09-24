import {
  createFakePluginHost,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { registerCodexAiService } from "./ai-service.js";
import type { CodexAiTextResult } from "./ai/host-contract.js";

function setup(
  answer: (call: ExperimentalFakeHostRpcCall) => CodexAiTextResult,
) {
  const { bb, harness } = createFakePluginHost({
    sdk: { system: { config: async () => ({ primaryHostId: "host-1" }) } },
    experimental_callHostRpc: answer,
  });
  registerCodexAiService(bb);
  const [service] = harness.registrations.aiServiceRegistrations;
  if (service?.complete === undefined || service.transcribe === undefined) {
    throw new Error("Codex did not register a complete and transcribe service");
  }
  return {
    complete: service.complete,
    transcribe: service.transcribe,
    calls: harness.inspection.experimental_hostRpcCalls,
  };
}

function modelOf(call: ExperimentalFakeHostRpcCall): unknown {
  return (call.input as { model?: unknown }).model;
}

describe("Codex AI service", () => {
  it("retries with the next model after a retryable failure", async () => {
    const codex = setup((call) =>
      modelOf(call) === "gpt-5.6-luna"
        ? { ok: false, code: "rate_limited", message: "Slow down" }
        : { ok: true, text: "Fix login bug" },
    );
    const signal = new AbortController().signal;

    await expect(codex.complete("Write a title", { signal })).resolves.toBe(
      "Fix login bug",
    );
    expect(codex.calls.map(modelOf)).toEqual(["gpt-5.6-luna", "gpt-5.4-mini"]);
    expect(codex.calls.map((call) => call.input)).toEqual([
      { model: "gpt-5.6-luna", prompt: "Write a title", timeoutMs: 5_000 },
      { model: "gpt-5.4-mini", prompt: "Write a title", timeoutMs: 5_000 },
    ]);
    expect(codex.calls.every((call) => call.signal === signal)).toBe(true);
  });

  it("stops at a failure another model cannot fix", async () => {
    const codex = setup(() => ({
      ok: false,
      code: "auth_required",
      message: "Run codex login",
    }));

    await expect(
      codex.complete("Write a title", {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Run codex login");
    expect(codex.calls).toHaveLength(1);
  });

  it("does not try the next model once bb has cancelled", async () => {
    const controller = new AbortController();
    const codex = setup(() => {
      controller.abort();
      return { ok: false, code: "service_unavailable", message: "Overloaded" };
    });

    await expect(
      codex.complete("Write a title", { signal: controller.signal }),
    ).rejects.toThrow("Overloaded");
    expect(codex.calls).toHaveLength(1);
  });

  it("refuses a recording over 20 MB before calling the host", async () => {
    const codex = setup(() => ({ ok: true, text: "unused" }));
    const audio = new File(
      [new Uint8Array(20 * 1024 * 1024 + 1)],
      "long.webm",
      { type: "audio/webm" },
    );

    await expect(
      codex.transcribe(audio, {
        signal: new AbortController().signal,
        hint: null,
      }),
    ).rejects.toThrow("Recordings over 20 MB are too large to transcribe");
    expect(codex.calls).toEqual([]);
  });

  it("sends a recording within the limit with bb's voice budget", async () => {
    const codex = setup(() => ({ ok: true, text: "hello" }));
    const audio = new File([new Uint8Array([1, 2, 3])], "clip.webm", {
      type: "audio/webm",
    });

    await expect(
      codex.transcribe(audio, {
        signal: new AbortController().signal,
        hint: "bb",
      }),
    ).resolves.toBe("hello");
    expect(codex.calls[0]?.input).toMatchObject({
      model: "gpt-transcribe",
      mimeType: "audio/webm",
      filename: "clip.webm",
      hint: "bb",
      timeoutMs: 10_000,
    });
  });
});
