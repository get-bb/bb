// @vitest-environment jsdom

import { defineRpcContract } from "@get-bb/plugin-sdk";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { PluginContext } from "@/components/plugin/plugin-context";
import { experimental_useRpcMutation } from "./plugin-rpc-hooks";
import { createAppQueryClient } from "./query-client";

const showMutationErrorToast = vi.hoisted(() => vi.fn());
vi.mock("./mutation-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mutation-errors")>()),
  showMutationErrorToast,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  showMutationErrorToast.mockReset();
});

it("toasts a failed core write but leaves a refused plugin write to the plugin", async () => {
  const client = createAppQueryClient();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "forbidden", message: "Caller cannot write" },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const contract = defineRpcContract({
    write: { input: z.object({ id: z.string() }), output: z.null() },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PluginContext.Provider value="demo">{children}</PluginContext.Provider>
    </QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      plugin: experimental_useRpcMutation({ contract, method: "write" }),
      core: useMutation({
        mutationFn: async () => {
          throw new Error("Core write failed");
        },
      }),
    }),
    { wrapper },
  );

  await act(async () => {
    await expect(
      result.current.plugin.mutate({ id: "a" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  await waitFor(() =>
    expect(result.current.plugin.error?.code).toBe("forbidden"),
  );
  expect(showMutationErrorToast).not.toHaveBeenCalled();

  await act(async () => {
    await result.current.core.mutateAsync().catch(() => undefined);
  });
  expect(showMutationErrorToast).toHaveBeenCalledTimes(1);
  client.clear();
});
