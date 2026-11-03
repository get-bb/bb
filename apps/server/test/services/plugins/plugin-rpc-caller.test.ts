import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { BbRequestTimeoutError, DEFAULT_BB_REQUEST_TIMEOUT_MS } from "@bb/sdk";
import { createPluginRpcCallerSdk } from "../../../src/services/plugins/plugin-rpc-caller.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the request timeout when a callRpc caller passes its own signal", async () => {
  const elapsed = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(elapsed.signal);
  vi.stubGlobal(
    "fetch",
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const sdk = createPluginRpcCallerSdk({
    baseUrl: "http://127.0.0.1:9",
    token: "caller-token",
  });

  const call = sdk.plugins.callRpc({
    pluginId: "slow",
    method: "wait",
    input: null,
    outputSchema: z.null(),
    signal: new AbortController().signal,
  });
  await vi.waitFor(() =>
    expect(timeout).toHaveBeenCalledWith(DEFAULT_BB_REQUEST_TIMEOUT_MS),
  );
  elapsed.abort(new DOMException("The operation timed out.", "TimeoutError"));

  await expect(call).rejects.toBeInstanceOf(BbRequestTimeoutError);
});
