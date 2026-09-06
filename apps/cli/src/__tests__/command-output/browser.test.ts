import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerBrowserCommands } from "../../commands/browser.js";

const tab = {
  active: true,
  connected: true,
  clientId: "client-1",
  navigationEpoch: 4,
  projectId: "proj-1",
  tabId: "tab-1",
  threadId: "thr-1",
  title: "Example",
  url: "https://example.test/",
  windowId: "window-1",
};

const owner = {
  active: true,
  clientId: "client-1",
  ownerId: "root-compose",
  projectId: "proj-1",
  threadId: "thr-1",
  windowId: "window-1",
};

describe("bb browser command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerBrowserCommands(program, () => "http://server");

  it("filters listed Browser tabs without changing their targets", async () => {
    const list = vi.fn(async () => ({ tabs: [tab], owners: [owner] }));
    stubServerApi({ "v1.browser.tabs.$get": list });

    await runCommand(
      ["browser", "list", "--thread", "thr-1", "--json"],
      register,
    );

    expect(list).toHaveBeenCalledWith({});
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({ tabs: [tab], owners: [owner] });
  });

  it("prints Browser tabs with their thread and project owners", async () => {
    const list = vi.fn(async () => ({ tabs: [tab], owners: [] }));
    stubServerApi({ "v1.browser.tabs.$get": list });

    await runCommand(["browser", "list"], register);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("THREAD");
    expect(output).toContain("PROJECT");
    expect(output).toContain("thr-1");
    expect(output).toContain("proj-1");
  });

  it("opens the first Browser tab through its thread panel owner", async () => {
    const open = vi.fn(async () => ({ target: tab }));
    stubServerApi({ "v1.browser.open.$post": open });

    await runCommand(
      [
        "browser",
        "open",
        "--thread",
        "thr-1",
        "--url",
        "file:///Users/test/page.html",
        "--json",
      ],
      register,
    );

    expect(open).toHaveBeenCalledWith({
      json: {
        url: "file:///Users/test/page.html",
        threadId: "thr-1",
        timeoutMs: 30_000,
      },
    });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({ target: tab });
  });

  it("sends a screenshot action to the exact listed Browser target", async () => {
    const control = vi.fn(async () => ({ value: "iVBORw0KGgo=" }));
    stubServerApi({ "v1.browser.control.$post": control });

    await runCommand(
      [
        "browser",
        "run",
        "--client",
        "client-1",
        "--window",
        "window-1",
        "--tab",
        "tab-1",
        "--epoch",
        "4",
        "--action",
        '{"kind":"screenshot","format":"png"}',
        "--json",
      ],
      register,
    );

    expect(control).toHaveBeenCalledWith({
      json: {
        action: { format: "png", kind: "screenshot" },
        target: {
          clientId: "client-1",
          navigationEpoch: 4,
          tabId: "tab-1",
          windowId: "window-1",
        },
        timeoutMs: 30_000,
      },
    });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({ value: "iVBORw0KGgo=" });
  });
  it("sends explicit native profile cookie import without exposing cookie values", async () => {
    const control = vi.fn(async () => ({ value: { importedCookies: 12 } }));
    stubServerApi({ "v1.browser.control.$post": control });

    await runCommand(
      [
        "browser",
        "run",
        "--client",
        "client-1",
        "--window",
        "window-1",
        "--tab",
        "tab-1",
        "--epoch",
        "4",
        "--action",
        '{"kind":"import-cookies-from-browser","family":"chrome","profileId":"Default"}',
        "--json",
      ],
      register,
    );

    expect(control).toHaveBeenCalledWith({
      json: {
        action: {
          kind: "import-cookies-from-browser",
          family: "chrome",
          profileId: "Default",
        },
        target: {
          clientId: "client-1",
          navigationEpoch: 4,
          tabId: "tab-1",
          windowId: "window-1",
        },
        timeoutMs: 30_000,
      },
    });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({ value: { importedCookies: 12 } });
  });

  it("waits for visible text through the first-class Browser action", async () => {
    const control = vi.fn(async () => ({
      value: {
        kind: "text",
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 4,
        },
      },
    }));
    stubServerApi({ "v1.browser.control.$post": control });

    await runCommand(
      [
        "browser",
        "wait",
        "--client",
        "client-1",
        "--window",
        "window-1",
        "--tab",
        "tab-1",
        "--epoch",
        "4",
        "--text",
        "Complete",
        "--timeout",
        "5",
        "--json",
      ],
      register,
    );

    expect(control).toHaveBeenCalledWith({
      json: {
        action: {
          kind: "wait",
          criteria: { kind: "text", text: "Complete" },
        },
        target: {
          clientId: "client-1",
          navigationEpoch: 4,
          tabId: "tab-1",
          windowId: "window-1",
        },
        timeoutMs: 5_000,
      },
    });
  });

  it("rejects a status modifier on a URL wait before SDK construction", async () => {
    const control = vi.fn();
    stubServerApi({ "v1.browser.control.$post": control });

    await expect(
      runCommand(
        [
          "browser",
          "wait",
          "--client",
          "client-1",
          "--window",
          "window-1",
          "--tab",
          "tab-1",
          "--epoch",
          "4",
          "--url",
          "https://example.test/",
          "--status",
          "200",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(control).not.toHaveBeenCalled();
  });

  it("sends a URL glob wait with its match modifier to the Browser", async () => {
    const control = vi.fn(async () => ({
      value: {
        kind: "url",
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 4,
        },
        url: "https://example.test/docs",
      },
    }));
    stubServerApi({ "v1.browser.control.$post": control });

    await runCommand(
      [
        "browser",
        "wait",
        "--client",
        "client-1",
        "--window",
        "window-1",
        "--tab",
        "tab-1",
        "--epoch",
        "4",
        "--url",
        "https://example.test/*",
        "--match",
        "glob",
        "--json",
      ],
      register,
    );

    expect(control).toHaveBeenCalledWith({
      json: {
        action: {
          kind: "wait",
          criteria: {
            kind: "url",
            url: "https://example.test/*",
            match: "glob",
          },
        },
        target: {
          clientId: "client-1",
          navigationEpoch: 4,
          tabId: "tab-1",
          windowId: "window-1",
        },
        timeoutMs: 30_000,
      },
    });
  });

  it("sends a response wait with status and method modifiers to the Browser", async () => {
    const control = vi.fn(async () => ({
      value: {
        kind: "response",
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 4,
        },
        url: "https://example.test/api",
        method: "GET",
        status: 200,
      },
    }));
    stubServerApi({ "v1.browser.control.$post": control });

    await runCommand(
      [
        "browser",
        "wait",
        "--client",
        "client-1",
        "--window",
        "window-1",
        "--tab",
        "tab-1",
        "--epoch",
        "4",
        "--response",
        "https://example.test/api",
        "--match",
        "exact",
        "--method",
        "GET",
        "--status",
        "200",
        "--json",
      ],
      register,
    );

    expect(control).toHaveBeenCalledWith({
      json: {
        action: {
          kind: "wait",
          criteria: {
            kind: "response",
            url: "https://example.test/api",
            match: "exact",
            method: "GET",
            status: 200,
          },
        },
        target: {
          clientId: "client-1",
          navigationEpoch: 4,
          tabId: "tab-1",
          windowId: "window-1",
        },
        timeoutMs: 30_000,
      },
    });
  });

  it("rejects a status modifier on a request wait before SDK construction", async () => {
    const control = vi.fn();
    stubServerApi({ "v1.browser.control.$post": control });

    await expect(
      runCommand(
        [
          "browser",
          "wait",
          "--client",
          "client-1",
          "--window",
          "window-1",
          "--tab",
          "tab-1",
          "--epoch",
          "4",
          "--request",
          "https://example.test/api",
          "--status",
          "200",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(control).not.toHaveBeenCalled();
  });

  it("sends bounded explicit-target Browser batches", async () => {
    const batch = vi.fn(async () => ({
      results: [{ id: "capture", ok: true, value: { scanned: 3 } }],
    }));
    stubServerApi({ "v1.browser.batch.$post": batch });
    const items = [
      {
        id: "capture",
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 4,
        },
        action: { kind: "snapshot", mode: "dom" },
      },
    ];

    await runCommand(
      [
        "browser",
        "batch",
        "--items",
        JSON.stringify(items),
        "--concurrency",
        "2",
        "--json",
      ],
      register,
    );

    expect(batch).toHaveBeenCalledWith({
      json: { items, concurrency: 2, timeoutMs: 30_000 },
    });
  });

  it("rejects malformed action JSON before contacting the Browser", async () => {
    const control = vi.fn();
    stubServerApi({ "v1.browser.control.$post": control });

    await expect(
      runCommand(
        [
          "browser",
          "run",
          "--client",
          "client-1",
          "--window",
          "window-1",
          "--tab",
          "tab-1",
          "--epoch",
          "4",
          "--action",
          "not-json",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(control).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "--action must be valid JSON",
    );
  });

  it("captures a tab and exports the bytes to a file", async () => {
    const mkdtemp = await import("node:fs/promises").then((m) => m.mkdtemp);
    const readFile = await import("node:fs/promises").then((m) => m.readFile);
    const rm = await import("node:fs/promises").then((m) => m.rm);
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "bb-capture-"));
    try {
      const out = path.join(dir, "shot.png");
      const expected = Buffer.alloc(262_147, 137);
      expected.fill(62, 262_144);
      const createCapture = vi.fn(async () => ({
        captureId: "capture-1",
        target: {
          clientId: "client-1",
          windowId: "window-1",
          tabId: "tab-1",
          navigationEpoch: 4,
        },
        mimeType: "image/png",
        expiresAt: Date.now() + 120_000,
        pixelSize: { width: 10, height: 10 },
        byteLength: expected.byteLength,
      }));
      const captureRead = vi.fn(
        async ({ json }: { json: { offset: number; length: number } }) => ({
          captureId: "capture-1",
          offset: json.offset,
          base64: expected
            .subarray(json.offset, json.offset + json.length)
            .toString("base64"),
          eof: json.offset + json.length >= expected.byteLength,
        }),
      );
      const captureRelease = vi.fn(async () => ({ released: true }));
      stubServerApi({
        "v1.browser.capture-create.$post": createCapture,
        "v1.browser.capture.$post": captureRead,
        "v1.browser.capture-release.$post": captureRelease,
      });

      await runCommand(
        [
          "browser",
          "capture",
          "--client",
          "client-1",
          "--window",
          "window-1",
          "--tab",
          "tab-1",
          "--epoch",
          "4",
          "--out",
          out,
        ],
        register,
      );

      expect(captureRelease).toHaveBeenCalledTimes(1);
      const written = await readFile(out);
      expect(written).toEqual(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a stale epoch for capture export before contacting the Browser", async () => {
    const createCapture = vi.fn(async () => {
      throw new Error("should not be called");
    });
    stubServerApi({ "v1.browser.capture-create.$post": createCapture });

    await expect(
      runCommand(
        [
          "browser",
          "capture",
          "--client",
          "client-1",
          "--window",
          "window-1",
          "--tab",
          "tab-1",
          "--epoch",
          "not-a-number",
          "--out",
          "/tmp/never.png",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(createCapture).not.toHaveBeenCalled();
  });

  it("dispatches a plugin contribution to an exact Browser target", async () => {
    const plugin = vi.fn(async () => ({ value: { captured: true } }));
    stubServerApi({ "v1.browser.plugin.$post": plugin });

    await runCommand(
      [
        "browser",
        "plugin",
        "--plugin",
        "annotations",
        "--controller",
        "pick",
        "--client",
        "client-1",
        "--window",
        "window-1",
        "--tab",
        "tab-1",
        "--epoch",
        "4",
        "--input",
        '{"mode":"interactive"}',
        "--json",
      ],
      register,
    );

    expect(plugin).toHaveBeenCalledWith({
      json: {
        pluginId: "annotations",
        controllerId: "pick",
        target: {
          clientId: "client-1",
          navigationEpoch: 4,
          tabId: "tab-1",
          windowId: "window-1",
        },
        input: { mode: "interactive" },
        timeoutMs: 30_000,
      },
    });
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}"),
    ).toEqual({ value: { captured: true } });
  });

  it("rejects malformed plugin contribution JSON before the Browser", async () => {
    const plugin = vi.fn();
    stubServerApi({ "v1.browser.plugin.$post": plugin });

    await expect(
      runCommand(
        [
          "browser",
          "plugin",
          "--plugin",
          "annotations",
          "--controller",
          "pick",
          "--client",
          "client-1",
          "--window",
          "window-1",
          "--tab",
          "tab-1",
          "--epoch",
          "4",
          "--input",
          "not-json",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(plugin).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "--input must be valid JSON",
    );
  });
});
