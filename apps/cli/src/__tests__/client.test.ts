import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliBbSdk } from "../client.js";

describe("createCliBbSdk", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    { threadId: "thr_caller", callerHeader: "thr_caller" },
    { threadId: undefined, callerHeader: null },
  ])(
    "marks requests as CLI requests with caller thread $callerHeader",
    async ({ threadId, callerHeader }) => {
      vi.stubEnv("BB_THREAD_ID", threadId);
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify({ ok: true, archivedThreadIds: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await createCliBbSdk("http://server").threads.archive({
        threadId: "thr_target",
      });

      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
      expect(headers.get("x-bb-cli")).toBe("1");
      expect(headers.get("x-bb-caller-thread")).toBe(callerHeader);
    },
  );
});
