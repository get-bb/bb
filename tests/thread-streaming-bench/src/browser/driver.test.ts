import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CdpConnection, CdpSessionError, type CdpSocket } from "./cdp.js";
import { BenchPage, launchBenchBrowser } from "./driver.js";

type Listener = (event: { data?: unknown }) => void;
type SentCommand = {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};

function isSentCommand(value: unknown): value is SentCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "method" in value &&
    typeof value.method === "string"
  );
}

class FakeSocket implements CdpSocket {
  readonly sent: SentCommand[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  send(data: string): void {
    const parsed: unknown = JSON.parse(data);
    if (!isSentCommand(parsed)) {
      throw new Error(`unexpected CDP message ${data}`);
    }
    this.sent.push(parsed);
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  lastCommand(method: string): SentCommand {
    const command = this.sent.filter((entry) => entry.method === method).at(-1);
    if (command === undefined) {
      throw new Error(`${method} was not sent`);
    }
    return command;
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createPage() {
  const socket = new FakeSocket();
  const connection = new CdpConnection(socket, { commandTimeoutMs: 60_000 });
  return { socket, page: new BenchPage(connection, "T1", "S1") };
}

function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => ({ value }),
    (reason: unknown) => reason,
  );
}

describe("launchBenchBrowser", () => {
  it("rejects missing or non-executable Chrome binaries before touching the profile", async () => {
    const base = await mkdtemp(join(tmpdir(), "bench-driver-test-"));
    try {
      const userDataDir = join(base, "profile");
      const missing = join(base, "missing-chrome");
      await expect(
        launchBenchBrowser({ chromePath: missing, userDataDir }),
      ).rejects.toThrow(
        `Chrome binary is missing or not executable: ${missing}`,
      );
      const notExecutable = join(base, "not-executable-chrome");
      await writeFile(notExecutable, "", { mode: 0o644 });
      await expect(
        launchBenchBrowser({ chromePath: notExecutable, userDataDir }),
      ).rejects.toThrow("CHROME_PATH");
      expect(await readdir(base)).toEqual(["not-executable-chrome"]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("BenchPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects navigate at its deadline when the navigation never commits and stops loading", async () => {
    vi.useFakeTimers();
    const { socket, page } = createPage();
    const navigation = settle(
      page.navigate("http://127.0.0.1:1/hang", { timeoutMs: 1_000 }),
    );
    expect(socket.lastCommand("Page.navigate").params).toEqual({
      url: "http://127.0.0.1:1/hang",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const stop = socket.lastCommand("Page.stopLoading");
    expect(stop.sessionId).toBe("S1");
    socket.receive({ id: stop.id, result: {}, sessionId: "S1" });
    const error = await navigation;
    expect(String(error)).toContain(
      "Timed out after 1000 ms navigating to http://127.0.0.1:1/hang",
    );
  });

  it("rejects navigate at its deadline when the load event never fires", async () => {
    vi.useFakeTimers();
    const { socket, page } = createPage();
    const navigation = settle(
      page.navigate("http://127.0.0.1:1/slow", { timeoutMs: 500 }),
    );
    socket.receive({
      id: socket.lastCommand("Page.navigate").id,
      result: { frameId: "F1", loaderId: "L1" },
      sessionId: "S1",
    });
    await vi.advanceTimersByTimeAsync(500);
    socket.receive({
      id: socket.lastCommand("Page.stopLoading").id,
      result: {},
      sessionId: "S1",
    });
    expect(String(await navigation)).toContain(
      "Timed out after 500 ms navigating",
    );
  });

  it("rejects waitForFunction at its deadline while an evaluation is still pending", async () => {
    vi.useFakeTimers();
    const { socket, page } = createPage();
    const wait = settle(
      page.waitForFunction("new Promise(() => {})", {
        timeoutMs: 500,
        pollMs: 50,
      }),
    );
    expect(socket.lastCommand("Runtime.evaluate").params).toMatchObject({
      awaitPromise: true,
      returnByValue: true,
    });
    await vi.advanceTimersByTimeAsync(500);
    const error = await wait;
    expect(String(error)).toContain(
      "Timed out after 500 ms waiting for new Promise(() => {}) (last error: Runtime.evaluate did not respond within 500 ms)",
    );
    expect(
      socket.sent.filter((entry) => entry.method === "Runtime.evaluate"),
    ).toHaveLength(1);
  });

  it("stops waitForFunction immediately when the target crashes", async () => {
    const { socket, page } = createPage();
    const wait = settle(
      page.waitForFunction("window.ready", { timeoutMs: 60_000 }),
    );
    socket.receive({
      method: "Inspector.targetCrashed",
      params: {},
      sessionId: "S1",
    });
    expect(await wait).toBeInstanceOf(CdpSessionError);
  });

  it("maps unserializable evaluation results to numbers and bigints", async () => {
    const { socket, page } = createPage();
    const cases: Array<[string, unknown]> = [
      ["NaN", Number.NaN],
      ["-0", -0],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["-12345678901234567890n", -12345678901234567890n],
    ];
    for (const [unserializableValue, expected] of cases) {
      const result = page.evaluate(unserializableValue);
      socket.receive({
        id: socket.lastCommand("Runtime.evaluate").id,
        result: { result: { type: "number", unserializableValue } },
        sessionId: "S1",
      });
      expect(Object.is(await result, expected)).toBe(true);
    }
  });
});
