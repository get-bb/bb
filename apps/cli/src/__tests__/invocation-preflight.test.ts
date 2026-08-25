import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCliInvocationAllowed,
  CliInvocationPreflightError,
  preflightCliInvocation,
  registerCliInvocationPreflight,
} from "../invocation-preflight.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const invocation = {
  baseUrl: "http://bb.test",
  argv: ["thread", "delete", "thread-1"],
  cwd: "/workspace",
  context: {},
} as const;

describe("CLI invocation preflight", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the exact CLI invocation and accepts an allowed response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ allowed: true }));

    await expect(
      preflightCliInvocation({
        baseUrl: "http://bb.test",
        argv: ["plugin", "disable", "policy"],
        cwd: "/workspace",
        context: { threadId: "thread-1", projectId: "project-1" },
      }),
    ).resolves.toEqual({ kind: "allowed" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://bb.test/api/v1/plugins/invocations/preflight");
    expect(JSON.parse(String(init?.body))).toEqual({
      argv: ["plugin", "disable", "policy"],
      cwd: "/workspace",
      threadId: "thread-1",
      projectId: "project-1",
    });
  });

  it("blocks on a policy block, a malformed answer, and a server error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(jsonResponse({ allowed: false, reason: "Denied by policy" }));
    await expect(assertCliInvocationAllowed(invocation)).rejects.toThrow("Denied by policy");

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(preflightCliInvocation(invocation)).resolves.toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("malformed response"),
    });

    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    await expect(preflightCliInvocation(invocation)).resolves.toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("malformed response"),
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "policy store unavailable" }, 500));
    await expect(preflightCliInvocation(invocation)).resolves.toEqual({
      kind: "blocked",
      reason: "BB invocation preflight failed: policy store unavailable",
    });

    fetchMock.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));
    await expect(preflightCliInvocation(invocation)).resolves.toEqual({
      kind: "blocked",
      reason: "BB invocation preflight failed: server returned HTTP 502",
    });

    // The server accepted the connection and went quiet: it is up and will
    // run the command, so its policy is not skipped.
    const headersTimeout = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Headers Timeout Error"), {
        code: "UND_ERR_HEADERS_TIMEOUT",
      }),
    });
    fetchMock.mockRejectedValueOnce(headersTimeout);
    await expect(preflightCliInvocation(invocation)).resolves.toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("did not answer"),
    });
  });

  it("skips the policy when the server is unreachable or predates the route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockRejectedValueOnce(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      }),
    );
    await expect(preflightCliInvocation(invocation)).resolves.toEqual({
      kind: "skipped",
      reason: "unreachable",
    });
    await expect(assertCliInvocationAllowed(invocation)).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response("<html>Not Found</html>", { status: 404 }));
    await expect(preflightCliInvocation(invocation)).resolves.toEqual({
      kind: "skipped",
      reason: "unsupported",
    });
  });

  it("runs once before a nested command action and prevents blocked actions", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ allowed: false, reason: "Thread commands disabled" }));
    const action = vi.fn();
    const program = new Command();
    program.command("thread").command("list").action(action);
    registerCliInvocationPreflight(program, {
      getUrl: () => "http://bb.test",
      getContext: () => ({ serverUrl: "http://bb.test" }),
      getArgv: () => ["thread", "list"],
      getCwd: () => "/workspace",
    });

    await expect(program.parseAsync(["node", "bb", "thread", "list"])).rejects.toBeInstanceOf(
      CliInvocationPreflightError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
  });

  it("does not preflight help or a local command, which execute no bb action", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const guide = vi.fn();
    const program = new Command();
    program.exitOverride();
    program.command("thread").action(() => undefined);
    program.command("guide").argument("[chapter]").action(guide);
    registerCliInvocationPreflight(program, {
      getUrl: () => "http://bb.test",
      getContext: () => ({ serverUrl: "http://bb.test" }),
      getArgv: () => ["thread", "--help"],
    });

    await expect(program.parseAsync(["node", "bb", "thread", "--help"])).rejects.toMatchObject({
      code: "commander.helpDisplayed",
    });
    await program.parseAsync(["node", "bb", "guide", "threads"]);
    expect(guide).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
