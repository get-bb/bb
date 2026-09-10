import { Buffer } from "node:buffer";
import type {
  ExperimentalAiVoiceTranscribeInput,
  ExperimentalAiVoiceTranscribeOutput,
} from "@get-bb/plugin-sdk/ai-services";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../../src/services/ai/voice-transcription.js";
import {
  registerFakeAiService,
  type FakeAiServiceCall,
} from "../helpers/ai-services.js";
import { seedHostSession } from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchResult = ReturnType<typeof fetch>;

interface ServiceTranscriptionHarness {
  app: TestAppHarness["app"];
  cleanup: TestAppHarness["cleanup"];
  deps: TestAppHarness["deps"];
  calls: FakeAiServiceCall<ExperimentalAiVoiceTranscribeInput>[];
}

function voiceFile(): File {
  return new File([Buffer.from("audio")], "prompt.webm", {
    type: "audio/webm",
  });
}

function emptyVoiceFile(): File {
  return new File([], "prompt.webm", { type: "audio/webm" });
}

async function createServiceTranscriptionHarness(
  transcribe: (
    input: ExperimentalAiVoiceTranscribeInput,
  ) => ExperimentalAiVoiceTranscribeOutput,
  overrides: {
    pluginTranscriptionMaxBytes?: number;
    serviceMaxVoiceBytes?: number;
  } = {},
): Promise<ServiceTranscriptionHarness> {
  const harness = await createTestAppHarness({
    inferenceFallbackModel: "codex/gpt-5.4-mini",
    transcriptionModel: "codex/gpt-transcribe",
    ...(overrides.pluginTranscriptionMaxBytes === undefined
      ? {}
      : { pluginTranscriptionMaxBytes: overrides.pluginTranscriptionMaxBytes }),
  });
  seedHostSession(harness.deps);
  const fake = registerFakeAiService(harness.deps.aiServices, {
    transcribeVoice: transcribe,
    ...(overrides.serviceMaxVoiceBytes === undefined
      ? {}
      : { maxVoiceBytes: overrides.serviceMaxVoiceBytes }),
  });
  return {
    app: harness.app,
    cleanup: harness.cleanup,
    deps: harness.deps,
    calls: fake.voiceCalls,
  };
}

function expectRetryableApiError(
  error: unknown,
  expected: { code: string; status: number },
): void {
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) {
    throw new Error("Expected ApiError.");
  }
  expect(error.status).toBe(expected.status);
  expect(error.body).toMatchObject({
    code: expected.code,
    retryable: true,
  });
}

describe("voice transcription", () => {
  it("rejects empty audio before calling the service", async () => {
    const harness = await createServiceTranscriptionHarness(() => {
      throw new Error("Empty audio must not reach the service");
    });
    try {
      const form = new FormData();
      form.set("file", emptyVoiceFile());
      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        { body: form, method: "POST" },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "invalid_request",
        message: "Audio file must not be empty",
      });
      expect(harness.calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("reports openai/* enablement from the API key even when a service registered the openai id", async () => {
    const harness = await createTestAppHarness({
      transcriptionModel: "openai/gpt-4o-transcribe",
      openAiApiKey: "",
    });
    try {
      seedHostSession(harness.deps);
      registerFakeAiService(harness.deps.aiServices, { id: "openai" });
      expect(resolveVoiceTranscriptionEnabled(harness.deps)).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects audio above the plugin-served cap before calling the service", async () => {
    const harness = await createServiceTranscriptionHarness(() => {
      throw new Error("Oversized audio must not reach the service");
    });
    try {
      const file = new File([Buffer.alloc(5 * 1024 * 1024 + 1)], "long.webm", {
        type: "audio/webm",
      });
      const error = await transcribeVoiceInput(harness.deps, { file }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 400,
        body: {
          code: "invalid_request",
          message:
            "Audio file exceeds the 5MB limit for plugin-served transcription",
        },
      });
      expect(harness.calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("forwards audio above the default cap when the configured limit is raised", async () => {
    const harness = await createServiceTranscriptionHarness(
      (input) => ({ ok: true, model: input.model, text: "long transcript" }),
      { pluginTranscriptionMaxBytes: 10 * 1024 * 1024 },
    );
    try {
      const file = new File([Buffer.alloc(5 * 1024 * 1024 + 1)], "long.webm", {
        type: "audio/webm",
      });
      await expect(
        transcribeVoiceInput(harness.deps, { file }),
      ).resolves.toBe("long transcript");
      expect(harness.calls).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects audio above the configured plugin-served cap using the configured size", async () => {
    const harness = await createServiceTranscriptionHarness(
      () => {
        throw new Error("Oversized audio must not reach the service");
      },
      { pluginTranscriptionMaxBytes: 8 * 1024 * 1024 },
    );
    try {
      const file = new File([Buffer.alloc(8 * 1024 * 1024 + 1)], "long.webm", {
        type: "audio/webm",
      });
      const error = await transcribeVoiceInput(harness.deps, { file }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 400,
        body: {
          code: "invalid_request",
          message:
            "Audio file exceeds the 8MB limit for plugin-served transcription",
        },
      });
      expect(harness.calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("enforces the service-declared cap even when the global ceiling is higher", async () => {
    const harness = await createServiceTranscriptionHarness(
      () => {
        throw new Error("Oversized audio must not reach the service");
      },
      {
        pluginTranscriptionMaxBytes: 25 * 1024 * 1024,
        serviceMaxVoiceBytes: 5 * 1024 * 1024,
      },
    );
    try {
      const file = new File([Buffer.alloc(5 * 1024 * 1024 + 1)], "long.webm", {
        type: "audio/webm",
      });
      const error = await transcribeVoiceInput(harness.deps, { file }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 400,
        body: {
          code: "invalid_request",
          message:
            "Audio file exceeds the 5MB limit for plugin-served transcription",
        },
      });
      expect(harness.calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("forwards audio up to the service cap when the global ceiling is higher", async () => {
    const harness = await createServiceTranscriptionHarness(
      (input) => ({ ok: true, model: input.model, text: "within service cap" }),
      {
        pluginTranscriptionMaxBytes: 25 * 1024 * 1024,
        serviceMaxVoiceBytes: 8 * 1024 * 1024,
      },
    );
    try {
      const file = new File([Buffer.alloc(6 * 1024 * 1024)], "long.webm", {
        type: "audio/webm",
      });
      await expect(
        transcribeVoiceInput(harness.deps, { file }),
      ).resolves.toBe("within service cap");
      expect(harness.calls).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("scales the per-attempt timeout with the audio size", async () => {
    const harness = await createServiceTranscriptionHarness((input) => ({
      ok: true,
      model: input.model,
      text: "long transcript",
    }));
    try {
      const file = new File([Buffer.alloc(2 * 1024 * 1024)], "long.webm", {
        type: "audio/webm",
      });
      await expect(
        transcribeVoiceInput(harness.deps, { file }),
      ).resolves.toBe("long transcript");
      expect(harness.calls).toHaveLength(1);
      expect(harness.calls[0]?.input.timeoutMs).toBe(30_000);
      expect(harness.calls[0]?.options.timeoutMs).toBe(31_000);
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps the 10s floor for short clips", async () => {
    const harness = await createServiceTranscriptionHarness((input) => ({
      ok: true,
      model: input.model,
      text: "short transcript",
    }));
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("short transcript");
      expect(harness.calls[0]?.input.timeoutMs).toBe(10_000);
    } finally {
      await harness.cleanup();
    }
  });

  it("sends openai/* to OpenAI directly even when a service registered the openai id", async () => {
    const harness = await createTestAppHarness({
      transcriptionModel: "openai/gpt-4o-transcribe",
    });
    seedHostSession(harness.deps);
    const fake = registerFakeAiService(harness.deps.aiServices, {
      id: "openai",
      transcribeVoice: () => {
        throw new Error("A registered openai service must not receive audio");
      },
    });
    const fetchStub = vi.fn(
      async (_input: FetchInput, _init?: FetchInit): FetchResult =>
        new Response(JSON.stringify({ text: "hello openai" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("hello openai");
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(fake.voiceCalls).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      await harness.cleanup();
    }
  });

  it("retries with the transcription model after service unavailability", async () => {
    let requestCount = 0;
    const harness = await createServiceTranscriptionHarness((input) => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          ok: false,
          code: "service_unavailable",
          message: "Codex transcription service unavailable",
        };
      }
      return { ok: true, model: input.model, text: "hello world" };
    });
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("hello world");
      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.input).toMatchObject({
        serviceId: "codex",
        model: "gpt-transcribe",
        timeoutMs: 10_000,
        mimeType: "audio/webm",
        filename: "prompt.webm",
      });
      expect(harness.calls[1]?.input).toMatchObject({
        model: "gpt-transcribe",
        timeoutMs: 10_000,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("returns retryable unavailable after exhausting rate limit retries", async () => {
    const harness = await createServiceTranscriptionHarness(() => ({
      ok: false,
      code: "rate_limited",
      message:
        "Codex transcription request failed with HTTP 429: Transcription is temporarily unavailable. Please try again later.",
    }));
    try {
      let thrown: unknown = null;
      try {
        await transcribeVoiceInput(harness.deps, { file: voiceFile() });
      } catch (error) {
        thrown = error;
      }

      expectRetryableApiError(thrown, {
        code: "transcription_unavailable",
        status: 503,
      });
      expect(harness.calls).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns retryable timeout after exhausting timeout retries", async () => {
    const harness = await createServiceTranscriptionHarness(() => ({
      ok: false,
      code: "timeout",
      message: "Timed out waiting for the transcription",
    }));
    try {
      let thrown: unknown = null;
      try {
        await transcribeVoiceInput(harness.deps, { file: voiceFile() });
      } catch (error) {
        thrown = error;
      }

      expectRetryableApiError(thrown, {
        code: "transcription_timeout",
        status: 504,
      });
      expect(harness.calls).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not retry non-retryable auth failures", async () => {
    const harness = await createServiceTranscriptionHarness(() => ({
      ok: false,
      code: "auth_required",
      message: "Codex transcription request failed with HTTP 401: Unauthorized",
    }));
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).rejects.toMatchObject({
        body: {
          code: "ai_service_auth_required",
          retryable: false,
        },
        status: 502,
      });
      expect(harness.calls).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("uses the 10 second timeout budget for OpenAI transcription", async () => {
    const harness = await createTestAppHarness({
      transcriptionModel: "openai/gpt-4o-transcribe",
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchStub = vi.fn(
      (_url: FetchInput, init?: FetchInit): FetchResult => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(
          new Response(JSON.stringify({ text: "hello openai" }), {
            status: 200,
          }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("hello openai");
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    } finally {
      vi.unstubAllGlobals();
      setTimeoutSpy.mockRestore();
      await harness.cleanup();
    }
  });
});
