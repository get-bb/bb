import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { JsonObject } from "@get-bb/plugin-sdk/provider-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeCodexInference,
  transcribeCodexVoice,
} from "./chatgpt-client.js";
import { resetChatGptCloudflareCookiesForTests } from "./chatgpt-fetch.js";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const tempDirs: string[] = [];

interface WriteCodexAuthArgs {
  homeDir: string;
  accessToken: string;
  refreshToken: string;
  accountId?: string;
  openAiApiKey?: string;
}

interface WriteCodexApiKeyAuthArgs {
  homeDir: string;
  apiKey: string;
}

interface CreateAccessTokenArgs {
  expSeconds: number;
  accountId: string;
}

async function makeTempHome(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-codex-auth-"));
  tempDirs.push(tempDir);
  vi.stubEnv("HOME", tempDir);
  return tempDir;
}

function base64UrlJson(value: JsonValue): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createJwt(payload: JsonObject): string {
  return `${base64UrlJson({ alg: "none", typ: "JWT" })}.${base64UrlJson(payload)}.sig`;
}

async function writeCodexAuth(args: WriteCodexAuthArgs): Promise<string> {
  const authDir = path.join(args.homeDir, ".codex");
  await fs.mkdir(authDir, { recursive: true });
  const authPath = path.join(authDir, "auth.json");
  await fs.writeFile(
    authPath,
    `${JSON.stringify(
      {
        auth_mode: "chatgpt",
        OPENAI_API_KEY: args.openAiApiKey,
        tokens: {
          access_token: args.accessToken,
          refresh_token: args.refreshToken,
          account_id: args.accountId,
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return authPath;
}

async function writeCodexApiKeyAuth(
  args: WriteCodexApiKeyAuthArgs,
): Promise<string> {
  const authDir = path.join(args.homeDir, ".codex");
  await fs.mkdir(authDir, { recursive: true });
  const authPath = path.join(authDir, "auth.json");
  await fs.writeFile(
    authPath,
    `${JSON.stringify(
      {
        auth_mode: "apikey",
        OPENAI_API_KEY: args.apiKey,
        tokens: null,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return authPath;
}

function createAccessToken(args: CreateAccessTokenArgs): string {
  return createJwt({
    exp: args.expSeconds,
    "https://api.openai.com/auth": {
      chatgpt_account_id: args.accountId,
    },
  });
}

function setupFetchMock(): FetchMock {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sseResponse(events: JsonValue[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`,
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

function stalledSseResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>(), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

function openSseResponse(events: JsonValue[]): {
  response: Response;
  wasCanceled: () => boolean;
} {
  let canceled = false;
  const bytes = new TextEncoder().encode(
    `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`,
  );
  return {
    response: new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
        },
        cancel() {
          canceled = true;
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      },
    ),
    wasCanceled: () => canceled,
  };
}

function delayedSseResponse(delayMs: number, events: JsonValue[]): Response {
  const bytes = new TextEncoder().encode(
    `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`,
  );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          try {
            controller.enqueue(bytes);
            controller.close();
          } catch {}
        }, delayMs);
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

function requiredFetchCall(fetchMock: FetchMock, index: number) {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`Missing fetch call at index ${index}`);
  }
  return call;
}

function headersFromInit(init: RequestInit | undefined): Headers {
  const headers = init?.headers;
  if (!(headers instanceof Headers)) {
    throw new Error("Expected request headers to be a Headers instance");
  }
  return headers;
}

function textBodyFromInit(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string");
  }
  return body;
}

function formDataBodyFromInit(init: RequestInit | undefined): FormData {
  const body = init?.body;
  if (!(body instanceof FormData)) {
    throw new Error("Expected request body to be FormData");
  }
  return body;
}

describe("Codex ChatGPT client", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetChatGptCloudflareCookiesForTests();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((tempDir) => fs.rm(tempDir, { force: true, recursive: true })),
    );
  });

  it("runs plain-text inference with Codex auth from ~/.codex/auth.json", async () => {
    const homeDir = await makeTempHome();
    const accessToken = createAccessToken({
      accountId: "account-123",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    await writeCodexAuth({
      homeDir,
      accessToken,
      refreshToken: "refresh-token",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: "response.output_text.delta",
          delta: "Short title",
        },
      ]),
    );

    const result = await completeCodexInference(
      {
        model: "gpt-5.6-luna",
        prompt: "Return a title",
        timeoutMs: 10000,
      },
      new AbortController().signal,
    );

    expect(result).toBe("Short title");
    const [, init] = requiredFetchCall(fetchMock, 0);
    const headers = headersFromInit(init);
    expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(headers.get("chatgpt-account-id")).toBe("account-123");
    expect(headers.get("openai-beta")).toBe("responses=experimental");
    const requestBody = JSON.parse(textBodyFromInit(init));
    expect(requestBody).toMatchObject({
      model: "gpt-5.6-luna",
      instructions:
        "Follow the user prompt. Reply with only the requested text, without quotes or commentary.",
      reasoning: { effort: "none" },
      stream: true,
    });
    expect(requestBody.text).toBeUndefined();
  });

  it("runs plain-text inference with Codex API key auth from ~/.codex/auth.json", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: "response.output_text.delta",
          delta: "OpenAI title",
        },
      ]),
    );

    const result = await completeCodexInference(
      {
        model: "gpt-5.6-luna",
        prompt: "Return a title",
        timeoutMs: 10000,
      },
      new AbortController().signal,
    );

    expect(result).toBe("OpenAI title");
    const [url, init] = requiredFetchCall(fetchMock, 0);
    expect(url).toBe("https://api.openai.com/v1/responses");
    const headers = headersFromInit(init);
    expect(headers.get("authorization")).toBe("Bearer sk-codex-api-key");
    expect(headers.get("chatgpt-account-id")).toBeNull();
    const requestBody = JSON.parse(textBodyFromInit(init));
    expect(requestBody).toMatchObject({
      model: "gpt-5.6-luna",
      instructions:
        "Follow the user prompt. Reply with only the requested text, without quotes or commentary.",
      reasoning: { effort: "none" },
      stream: true,
    });
    expect(requestBody.text).toBeUndefined();
  });

  it("classifies streamed overload failures as service unavailable", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: "response.failed",
          response: {
            error: {
              message:
                "Our servers are currently overloaded. Please try again later.",
            },
          },
        },
      ]),
    );

    await expect(
      completeCodexInference(
        {
          model: "gpt-5.6-luna",
          prompt: "Return a title",
          timeoutMs: 10_000,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_service_unavailable",
    });
  });

  it("preserves structured server error codes from failed responses", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: "response.failed",
          response: {
            error: {
              code: "server_error",
              message: "An unexpected provider error occurred.",
            },
          },
        },
      ]),
    );

    await expect(
      completeCodexInference(
        {
          model: "gpt-5.6-luna",
          prompt: "Return a title",
          timeoutMs: 10_000,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_service_unavailable",
      message: "An unexpected provider error occurred.",
    });
  });

  it("cancels an open SSE body after a terminal failure event", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    const failedResponse = openSseResponse([
      {
        type: "response.failed",
        response: {
          error: {
            code: "server_error",
            message: "An unexpected provider error occurred.",
          },
        },
      },
    ]);
    fetchMock.mockResolvedValueOnce(failedResponse.response);

    await expect(
      completeCodexInference(
        {
          model: "gpt-5.6-luna",
          prompt: "Return a title",
          timeoutMs: 100,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_service_unavailable",
    });
    expect(failedResponse.wasCanceled()).toBe(true);
  });

  it("uses Codex auth read-only without refreshing expired-looking access tokens", async () => {
    const homeDir = await makeTempHome();
    const oldAccessToken = createAccessToken({
      accountId: "account-old",
      expSeconds: Math.floor(Date.now() / 1000) - 60,
    });
    const authPath = await writeCodexAuth({
      homeDir,
      accessToken: oldAccessToken,
      refreshToken: "old-refresh-token",
    });
    const originalAuthJson = await fs.readFile(authPath, "utf8");
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: "response.output_text.delta",
          delta: "Fresh",
        },
      ]),
    );

    await completeCodexInference(
      {
        model: "gpt-5.4-mini",
        prompt: "Return a title",
        timeoutMs: 10000,
      },
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = requiredFetchCall(fetchMock, 0);
    expect(headersFromInit(init).get("authorization")).toBe(
      `Bearer ${oldAccessToken}`,
    );
    expect(headersFromInit(init).get("chatgpt-account-id")).toBe("account-old");
    await expect(fs.readFile(authPath, "utf8")).resolves.toBe(originalAuthJson);
  });

  it("rejects oversized Codex SSE responses", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        {
          type: "response.output_text.delta",
          delta: "x".repeat(2 * 1024 * 1024),
        },
      ]),
    );

    await expect(
      completeCodexInference(
        {
          model: "gpt-5.4-mini",
          prompt: "Return a title",
          timeoutMs: 10000,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_response_too_large",
    });
  });

  it("times out stalled Codex SSE body reads after headers", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(stalledSseResponse());

    await expect(
      completeCodexInference(
        {
          model: "gpt-5.4-mini",
          prompt: "Return a title",
          timeoutMs: 20,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_request_timeout",
    });
  });

  it("stops reading the stream when bb cancels the host call", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(stalledSseResponse());
    const controller = new AbortController();

    const pending = completeCodexInference(
      {
        model: "gpt-5.6-luna",
        prompt: "Return a title",
        timeoutMs: 10_000,
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      detailCode: "codex_request_cancelled",
    });
  });

  it("aborts the fetch when bb cancels before the response arrives", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    let fetchSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal ?? undefined;
          fetchSignal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const controller = new AbortController();

    const pending = completeCodexInference(
      {
        model: "gpt-5.6-luna",
        prompt: "Return a title",
        timeoutMs: 10_000,
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      detailCode: "codex_request_cancelled",
    });
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("uses one deadline across response headers and SSE body reads", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return delayedSseResponse(40, [
        {
          type: "response.output_text.delta",
          delta: '{"title":"Too late"}',
        },
      ]);
    });

    await expect(
      completeCodexInference(
        {
          model: "gpt-5.6-luna",
          prompt: "Return a title",
          timeoutMs: 60,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_request_timeout",
    });
  });

  it("caps oversized Codex error response bodies", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(10 * 1024), {
        status: 500,
      }),
    );

    let thrown: Error | null = null;
    try {
      await completeCodexInference(
        {
          model: "gpt-5.4-mini",
          prompt: "Return a title",
          timeoutMs: 10000,
        },
        new AbortController().signal,
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("Expected Error from oversized Codex error response");
      }
      thrown = error;
    }

    expect(thrown).toMatchObject({
      detailCode: "codex_service_unavailable",
    });
    expect(thrown?.message.length).toBeLessThan(700);
  });

  it("retries ChatGPT transcription once with allowed Cloudflare cookies", async () => {
    const homeDir = await makeTempHome();
    const accessToken = createAccessToken({
      accountId: "account-123",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    await writeCodexAuth({
      homeDir,
      accessToken,
      refreshToken: "refresh-token",
    });
    const fetchMock = setupFetchMock();
    fetchMock
      .mockResolvedValueOnce(
        new Response("challenge", {
          status: 403,
          headers: {
            "cf-mitigated": "challenge",
            "set-cookie": "__cf_bm=cloudflare-cookie; Path=/; Secure; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "hello world" }), {
          status: 200,
        }),
      );

    const result = await transcribeCodexVoice(
      {
        model: "gpt-4o-mini-transcribe",
        audioBase64: Buffer.from("audio").toString("base64"),
        mimeType: "audio/webm",
        filename: "prompt.webm",
        hint: null,
        timeoutMs: 30000,
      },
      new AbortController().signal,
    );

    expect(result).toBe("hello world");
    const [, retryInit] = requiredFetchCall(fetchMock, 1);
    const retryHeaders = headersFromInit(retryInit);
    expect(retryHeaders.get("cookie")).toBe("__cf_bm=cloudflare-cookie");
    expect(retryHeaders.get("authorization")).toBe(`Bearer ${accessToken}`);
  });

  it("classifies a persistent Cloudflare challenge as transient without leaking the challenge page", async () => {
    const homeDir = await makeTempHome();
    const accessToken = createAccessToken({
      accountId: "account-123",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    await writeCodexAuth({
      homeDir,
      accessToken,
      refreshToken: "refresh-token",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          `<html>\n<head>\n<meta name="viewport" content="width=device-width" />\n<title>Just a moment...</title>\n<style>body{font-family:Arial}</style>\n</head><body>${"x".repeat(2000)}</body></html>`,
          {
            status: 403,
            headers: {
              "content-type": "text/html; charset=UTF-8",
              "cf-mitigated": "challenge",
              server: "cloudflare",
              "set-cookie":
                "__cf_bm=cloudflare-cookie; Path=/; Secure; HttpOnly",
            },
          },
        ),
    );

    let thrown: Error | null = null;
    try {
      await transcribeCodexVoice(
        {
          model: "gpt-4o-mini-transcribe",
          audioBase64: Buffer.from("audio").toString("base64"),
          mimeType: "audio/webm",
          filename: "prompt.webm",
          hint: null,
          timeoutMs: 30000,
        },
        new AbortController().signal,
      );
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("Expected Error from challenged transcription");
      }
      thrown = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(thrown).toMatchObject({
      detailCode: "codex_service_unavailable",
      message:
        "Codex transcription request failed with HTTP 403: chatgpt.com answered with a Cloudflare challenge that bb cannot solve. Retry, or choose another service in Settings → AI services.",
    });
  });

  it("omits HTML error pages from Codex error messages", async () => {
    const homeDir = await makeTempHome();
    const accessToken = createAccessToken({
      accountId: "account-123",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    await writeCodexAuth({
      homeDir,
      accessToken,
      refreshToken: "refresh-token",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      new Response("<html><body>Access denied (error 1020)</body></html>", {
        status: 403,
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
    );

    await expect(
      transcribeCodexVoice(
        {
          model: "gpt-4o-mini-transcribe",
          audioBase64: Buffer.from("audio").toString("base64"),
          mimeType: "audio/webm",
          filename: "prompt.webm",
          hint: null,
          timeoutMs: 30000,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_request_failed",
      message: "Codex transcription request failed with HTTP 403",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("transcribes voice with Codex API key auth from ~/.codex/auth.json", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hello openai" }), {
        status: 200,
      }),
    );

    const result = await transcribeCodexVoice(
      {
        model: "gpt-4o-mini-transcribe",
        audioBase64: Buffer.from("audio").toString("base64"),
        mimeType: "audio/webm",
        filename: "prompt.webm",
        hint: "context",
        timeoutMs: 30000,
      },
      new AbortController().signal,
    );

    expect(result).toBe("hello openai");
    const [url, init] = requiredFetchCall(fetchMock, 0);
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const headers = headersFromInit(init);
    expect(headers.get("authorization")).toBe("Bearer sk-codex-api-key");
    expect(headers.get("cookie")).toBeNull();
    const body = formDataBodyFromInit(init);
    expect(body.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(body.get("prompt")).toBe("context");
  });

  it("reports ChatGPT transcription rate limits with the nested provider message", async () => {
    const homeDir = await makeTempHome();
    const accessToken = createAccessToken({
      accountId: "account-123",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    await writeCodexAuth({
      homeDir,
      accessToken,
      refreshToken: "refresh-token",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: {
            detail:
              "Transcription is temporarily unavailable. Please try again later.",
          },
        }),
        {
          status: 429,
        },
      ),
    );

    await expect(
      transcribeCodexVoice(
        {
          model: "gpt-4o-mini-transcribe",
          audioBase64: Buffer.from("audio").toString("base64"),
          mimeType: "audio/webm",
          filename: "prompt.webm",
          hint: null,
          timeoutMs: 30000,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_rate_limited",
      message:
        "Codex transcription request failed with HTTP 429: Transcription is temporarily unavailable. Please try again later.",
    });
  });

  it("rejects oversized Codex transcription responses", async () => {
    const homeDir = await makeTempHome();
    await writeCodexApiKeyAuth({
      homeDir,
      apiKey: "sk-codex-api-key",
    });
    const fetchMock = setupFetchMock();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: "x".repeat(1024 * 1024),
        }),
        {
          status: 200,
        },
      ),
    );

    await expect(
      transcribeCodexVoice(
        {
          model: "gpt-4o-mini-transcribe",
          audioBase64: Buffer.from("audio").toString("base64"),
          mimeType: "audio/webm",
          filename: "prompt.webm",
          hint: null,
          timeoutMs: 30000,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      detailCode: "codex_response_too_large",
    });
  });
});
