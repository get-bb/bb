import { afterEach, describe, expect, it, vi } from "vitest";
import { cliFetch } from "../client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cliFetch", () => {
  it("delegates requests without injecting daemon credentials", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const init = { headers: { "content-type": "application/json" } };
    await cliFetch("http://127.0.0.1:38886/api/v1/threads", init);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:38886/api/v1/threads",
      init,
    );
  });
});
