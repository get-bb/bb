import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { registerCodexAiService } from "./ai-service.js";
import { transcribeCodexVoice } from "./ai/chatgpt-client.js";
import { codexAiTranscribeInputSchema } from "./ai/host-contract.js";

vi.mock("./ai/codex-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai/codex-auth.js")>()),
  readCodexAuthCredentials: async () => ({
    type: "chatgpt",
    accessToken: "synthetic-test-token",
    accountId: "synthetic-test-account",
    accountEmail: null,
    expired: false,
    isFedrampAccount: false,
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([12_000, 64_000])(
  "returns a transcript when the endpoint responds after %i ms",
  async (responseMs) => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Missing request cancellation signal");
        return new Promise<Response>((resolve, reject) => {
          const abort = () => {
            clearTimeout(responseTimer);
            reject(new DOMException("Request aborted", "AbortError"));
          };
          const responseTimer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve(Response.json({ text: "A completed voice note" }));
          }, responseMs);
          signal.addEventListener("abort", abort, { once: true });
        });
      }),
    );
    const { bb, harness } = createFakePluginHost({
      sdk: { system: { config: async () => ({ primaryHostId: "host-1" }) } },
      experimental_callHostRpc: async (call) => ({
        ok: true,
        text: await transcribeCodexVoice(
          codexAiTranscribeInputSchema.parse(call.input),
          call.signal ?? new AbortController().signal,
        ),
      }),
    });
    registerCodexAiService(bb);
    const [service] = harness.registrations.aiServiceRegistrations;
    if (!service?.transcribe) throw new Error("Missing voice service");

    const result = service
      .transcribe(
        new File(["synthetic audio"], "note.webm", { type: "audio/webm" }),
        { signal: new AbortController().signal, hint: null },
      )
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(responseMs);
    await expect(result).resolves.toBe("A completed voice note");
  },
);
