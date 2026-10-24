import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fillTarget,
  findPageTarget,
  redactFilled,
  sameSite,
  siteOf,
} from "./fill.js";
import type { PreviewSocket } from "./preview.js";

const planted = 'planted-"Secret"-5be1';

vi.mock("./process.js", () => ({
  supervise: vi.fn(),
  execute: vi.fn(),
}));

type Responder = (
  method: string,
  params: Record<string, unknown>,
) => { result?: unknown; error?: { message: string } };

function fakeCdp(respond: Responder) {
  const sent: string[] = [];
  const listeners = new Map<
    string,
    Array<(event: { data: unknown }) => void>
  >();
  let readyState = 1;
  const socket: PreviewSocket = {
    get readyState() {
      return readyState;
    },
    send(data: string) {
      sent.push(data);
      const message = JSON.parse(data) as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      const reply = respond(message.method, message.params);
      queueMicrotask(() => {
        for (const listener of listeners.get("message") ?? [])
          listener({ data: JSON.stringify({ id: message.id, ...reply }) });
      });
    },
    close() {
      readyState = 3;
    },
    addEventListener(
      type: string,
      listener: ((event: { data: unknown }) => void) | (() => void),
    ) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  return { socket, sent };
}

const page =
  (url: string, fillResult: unknown = "ok"): Responder =>
  (method) => {
    switch (method) {
      case "Target.attachToTarget":
        return { result: { sessionId: "cdp-session" } };
      case "Page.getFrameTree":
        return { result: { frameTree: { frame: { id: "frame", url } } } };
      case "Page.createIsolatedWorld":
        return { result: { executionContextId: 7 } };
      case "Runtime.callFunctionOn":
        return { result: { result: { type: "string", value: fillResult } } };
      default:
        return { error: { message: `unexpected ${method}` } };
    }
  };

const fill = (socket: PreviewSocket, expectedOrigin: string) =>
  fillTarget({
    connectionUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    targetId: "target",
    selector: "#password",
    value: planted,
    expectedOrigin,
    signal: new AbortController().signal,
    openSocket: () => socket,
  });

describe("fill origin policy", () => {
  it.each([
    ["https://accounts.intuit.com/signin", "https://intuit.com", true],
    ["https://www.taxact.com/login", "https://taxact.com", true],
    ["http://accounts.intuit.com", "https://intuit.com", false],
    ["https://intuit.com.evil.example", "https://intuit.com", false],
    ["https://evil-intuit.com", "https://intuit.com", false],
    ["https://alice.github.io", "https://bob.github.io", false],
    ["https://127.0.0.1:8443", "https://127.0.0.1", true],
    ["https://127.0.0.2", "https://127.0.0.1", false],
    ["about:blank", "https://intuit.com", false],
    ["https://intuit.com", "http://intuit.com", false],
  ])("%s against %s is %s", (actual, expected, allowed) => {
    expect(sameSite(actual, expected)).toBe(allowed);
  });

  it("has no site for non-HTTPS or malformed URLs", () => {
    expect(siteOf("http://example.com")).toBeNull();
    expect(siteOf("not a url")).toBeNull();
    expect(siteOf("data:text/html,x")).toBeNull();
  });
});

describe("fillTarget", () => {
  it("passes the value only as a call argument to an isolated world after the site check", async () => {
    const cdp = fakeCdp(page("https://accounts.intuit.com/signin"));
    expect(await fill(cdp.socket, "https://intuit.com")).toBe("ok");
    const messages = cdp.sent.map(
      (data) =>
        JSON.parse(data) as { method: string; params: Record<string, unknown> },
    );
    expect(messages.map((message) => message.method)).toEqual([
      "Target.attachToTarget",
      "Page.getFrameTree",
      "Page.createIsolatedWorld",
      "Runtime.callFunctionOn",
    ]);
    const call = messages[3]!.params;
    expect(call.arguments).toEqual([
      { value: "https://accounts.intuit.com" },
      { value: "#password" },
      { value: planted },
    ]);
    expect(call.functionDeclaration).not.toContain(planted);
    expect(call.silent).toBe(true);
    expect(
      cdp.sent.filter((data) => data.includes(JSON.stringify(planted))),
    ).toHaveLength(1);
  });

  it("refuses another site before the value leaves the process", async () => {
    const cdp = fakeCdp(page("https://intuit.com.evil.example/login"));
    expect(await fill(cdp.socket, "https://intuit.com")).toBe(
      "origin_mismatch",
    );
    expect(cdp.sent.join("\n")).not.toContain("Secret");
  });

  it("reports a navigation that destroys the isolated world", async () => {
    const base = page("https://accounts.intuit.com/signin");
    const cdp = fakeCdp((method, params) =>
      method === "Runtime.callFunctionOn"
        ? { error: { message: "Cannot find context with specified id" } }
        : base(method, params),
    );
    expect(await fill(cdp.socket, "https://intuit.com")).toBe("navigated");
  });

  it.each([
    ["element_not_found", "element_not_found"],
    ["navigated", "navigated"],
    [`leaked ${planted}`, "fill_failed"],
    [null, "fill_failed"],
  ])("maps page result %s to fixed code %s", async (result, code) => {
    const cdp = fakeCdp(page("https://accounts.intuit.com", result));
    expect(await fill(cdp.socket, "https://intuit.com")).toBe(code);
  });

  it("returns page_not_found when the target cannot be attached", async () => {
    const cdp = fakeCdp(() => ({ error: { message: "No target" } }));
    expect(await fill(cdp.socket, "https://intuit.com")).toBe("page_not_found");
  });
});

describe("filled value masking", () => {
  it("redacts raw and JSON-escaped forms", () => {
    const text = `value=${planted} json=${JSON.stringify(planted)}`;
    const redacted = redactFilled(text, new Set([planted]));
    expect(redacted).not.toContain("Secret");
    expect(redacted).toBe(`value=[filled value] json="[filled value]"`);
  });

  it("finds a named page target in a DevBrowser listing", () => {
    const listing = JSON.stringify([
      { id: "A1", name: null, url: "about:blank", title: "" },
      { id: "B2", name: "main", url: "https://x.test", title: "X" },
    ]);
    expect(findPageTarget(listing, "main")).toBe("B2");
    expect(findPageTarget(listing, "other")).toBeNull();
    expect(findPageTarget("not json", "main")).toBeNull();
  });
});

describe("runtime fill channels", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("keeps a planted value out of argv, env, and every later output", async () => {
    const processes = await import("./process.js");
    const { createRuntime } = await import("./runtime.js");
    const root = await mkdtemp(join(tmpdir(), "browser-fill-test-"));
    dirs.push(root);
    const spawned: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    vi.mocked(processes.supervise).mockImplementation((_command, args, env) => {
      spawned.push({ args, env });
      if (args[0] === "daemon")
        void writeFile(join(env.DEV_BROWSER_HOME!, "daemon.pid"), "1");
      return { alive: () => true, close: async () => {} };
    });
    const frames = (value: string) =>
      [
        { type: "hello", protocol: 1, version: "1.0.0-test", pid: 1 },
        { type: "result", value },
        { type: "done", exitCode: 0, durationMs: 1 },
      ]
        .map((frame) => JSON.stringify(frame))
        .join("\n");
    vi.mocked(processes.execute).mockImplementation(
      async (_command, args, env) => {
        spawned.push({ args, env });
        const script = args.at(-1)!;
        return frames(
          script === "await browser.listPages()"
            ? JSON.stringify([{ id: "T1", name: "main", url: "", title: "" }])
            : `field=${planted} snapshot: textbox "Password" ${JSON.stringify(planted)}`,
        );
      },
    );
    const cdp = fakeCdp(page("https://accounts.intuit.com/signin"));
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        return cdp.socket;
      }),
    );
    const runtime = await createRuntime({
      runtime: {
        binary: "/bin/dev-browser",
        version: "1.0.0-test",
        source: "release",
      },
      dataDir: root,
      tempDir: join(root, "sessions"),
      connectionUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      signal: new AbortController().signal,
    });
    const signal = new AbortController().signal;
    expect(
      await runtime.fill(
        {
          page: "main",
          selector: "#password",
          value: planted,
          expectedOrigin: "https://intuit.com",
        },
        signal,
      ),
    ).toBe("ok");
    const read = await runtime.run("await page.snapshot()", 5_000, signal);
    expect(JSON.stringify(read)).not.toContain("Secret");
    expect(read.text).toContain("[filled value]");
    expect(JSON.stringify(spawned)).not.toContain("Secret");
    await runtime.close();
  });
});
