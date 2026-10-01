// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { threadsQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { useSenderThreadMetadataById } from "./useSenderThreadMetadataById";
import { createQueryNotificationScheduler } from "@/test/queryNotificationScheduler";

const notifications = createQueryNotificationScheduler();

function renderMetadataHook(queryClient: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return renderHook(() => useSenderThreadMetadataById(), { wrapper: Wrapper });
}

beforeEach(() => notifications.install());

afterEach(() => {
  cleanup();
  notifications.restore();
});

describe("useSenderThreadMetadataById", () => {
  it("keeps the same map reference when a cache event rebuilds equal metadata", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender", title: "Sender thread" }),
    ]);
    const { result } = renderMetadataHook(queryClient);
    const initial = result.current;
    expect(initial.get("thr_sender")?.title).toBe("Sender thread");
    expect(initial.get("thr_sender")?.projectId).toBe("proj_test");

    await act(async () => {
      queryClient.setQueryData(threadsQueryKey(), [
        makeThreadListEntry({ id: "thr_sender", title: "Sender thread" }),
      ]);
    });
    await notifications.flush();

    expect(result.current).toBe(initial);
  });

  it("returns a new map when thread metadata actually changes", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender", title: null }),
    ]);
    const { result } = renderMetadataHook(queryClient);
    const initial = result.current;
    expect(initial.get("thr_sender")?.title).toBeNull();

    await act(async () => {
      queryClient.setQueryData(threadsQueryKey(), [
        makeThreadListEntry({ id: "thr_sender", title: "Titled later" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.get("thr_sender")?.title).toBe("Titled later");
    });
    expect(result.current).not.toBe(initial);
  });
});
