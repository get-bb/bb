import { Buffer } from "node:buffer";
import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { transcribeVoiceInput } from "../../src/services/ai/voice-transcription.js";
import {
  registerHostRpcResponder,
  type HostRpcResponder,
  type RegisterHostRpcResponderArgs,
} from "../helpers/host-rpc.js";
import { seedHostSession } from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchResult = ReturnType<typeof fetch>;

type CodexVoiceTranscribeCommand = Extract<
  HostDaemonOnlineRpcRequestMessage["command"],
  { type: "codex.voice.transcribe" }
>;

interface CodexTranscriptionHarness {
  app: TestAppHarness["app"];
  cleanup: TestAppHarness["cleanup"];
  deps: TestAppHarness["deps"];
  requests: HostRpcResponder["requests"];
}

interface CreateCodexTranscriptionHarnessArgs {
  handle: RegisterHostRpcResponderArgs["handle"];
}

function voiceFile(): File {
  return new File([Buffer.from("audio")], "prompt.webm", {
    type: "audio/webm",
  });
}

function emptyVoiceFile(): File {
  return new File([], "prompt.webm", { type: "audio/webm" });
}

function requireCodexVoiceTranscribeCommand(
  request: HostDaemonOnlineRpcRequestMessage,
): CodexVoiceTranscribeCommand {
  const command = request.command;
  if (command.type !== "codex.voice.transcribe") {
    throw new Error(`Unexpected command ${command.type}`);
  }
  return command;
}

async function createCodexTranscriptionHarness({
  handle,
}: CreateCodexTranscriptionHarnessArgs): Promise<CodexTranscriptionHarness> {
  const harness = await createTestAppHarness({
    inferenceFallbackModel: "codex/gpt-5.4-mini",
    transcriptionModel: "codex/gpt-transcribe",
  });
  const { host, session } = seedHostSession(harness.deps);
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle,
  });
  return {
    app: harness.app,
    cleanup: harness.cleanup,
    deps: harness.deps,
    requests: responder.requests,
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
  it("rejects empty audio before sending a host RPC command", async () => {
    const harness = await createCodexTranscriptionHarness({
      handle() {
        throw new Error("Empty audio must not reach the host daemon");
      },
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
      expect(harness.requests).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("retries with the transcription model after Codex service unavailability", async () => {
    let requestCount = 0;
    const harness = await createCodexTranscriptionHarness({
      handle(request) {
        const command = requireCodexVoiceTranscribeCommand(request);
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: false,
            errorCode: "codex_service_unavailable",
            errorMessage: "Codex transcription service unavailable",
          };
        }
        return {
          ok: true,
          result: {
            model: command.model,
            text: "hello world",
          },
        };
      },
    });
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("hello world");
      expect(harness.requests).toHaveLength(2);
      expect(harness.requests[0]?.command).toMatchObject({
        model: "gpt-transcribe",
        timeoutMs: 10_000,
        type: "codex.voice.transcribe",
      });
      expect(harness.requests[1]?.command).toMatchObject({
        model: "gpt-transcribe",
        timeoutMs: 10_000,
        type: "codex.voice.transcribe",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("returns retryable unavailable after exhausting Codex rate limit retries", async () => {
    const harness = await createCodexTranscriptionHarness({
      handle(request) {
        requireCodexVoiceTranscribeCommand(request);
        return {
          ok: false,
          errorCode: "codex_rate_limited",
          errorMessage:
            "Codex transcription request failed with HTTP 429: Transcription is temporarily unavailable. Please try again later.",
        };
      },
    });
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
      expect(harness.requests).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns retryable timeout after exhausting Codex timeout retries", async () => {
    const harness = await createCodexTranscriptionHarness({
      handle(request) {
        requireCodexVoiceTranscribeCommand(request);
        return {
          ok: false,
          errorCode: "command_timeout",
          errorMessage: "Timed out waiting for command result",
        };
      },
    });
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
      expect(harness.requests).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not retry non-retryable Codex auth failures", async () => {
    const harness = await createCodexTranscriptionHarness({
      handle(request) {
        requireCodexVoiceTranscribeCommand(request);
        return {
          ok: false,
          errorCode: "codex_auth_failed",
          errorMessage:
            "Codex transcription request failed with HTTP 401: Unauthorized",
        };
      },
    });
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).rejects.toMatchObject({
        body: {
          code: "codex_auth_failed",
          retryable: false,
        },
        status: 502,
      });
      expect(harness.requests).toHaveLength(1);
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
