import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGitHubStars } from "./github-stars.js";

function respond(response: Response | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

describe("fetchGitHubStars", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the repo's star count, authenticating when given a token", async () => {
    const fetch = respond(Response.json({ stargazers_count: 4762 }));
    expect(await fetchGitHubStars({ fetch, token: "t0ken" })).toBe(4762);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/get-bb/bb");
    expect(init.headers).toMatchObject({ authorization: "Bearer t0ken" });
  });

  it.each([
    ["a rate limit", new Response("{}", { status: 403 })],
    ["a missing count", Response.json({ message: "Not Found" })],
    ["a malformed count", Response.json({ stargazers_count: "4762" })],
    ["a body that is not JSON", new Response("<html>")],
    ["a network failure", new TypeError("fetch failed")],
    ["a timeout", new DOMException("timed out", "TimeoutError")],
  ])("falls back to no count on %s", async (_name, response) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchGitHubStars({ fetch: respond(response) })).toBeNull();
  });
});
