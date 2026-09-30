import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { BB_PI_EXTENSION_SOURCE } from "./bb-pi-extension.js";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import { PiRpcSession, type PiPromptRunOutcome } from "./rpc-session.js";

it("settles handled commands and intercepted input without agent events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-pi-command-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir);
  const extensionPath = join(dir, "bridge.mjs");
  const commandPath = join(dir, "commands.mjs");
  writeFileSync(extensionPath, BB_PI_EXTENSION_SOURCE);
  writeFileSync(
    commandPath,
    `
  import { existsSync, writeFileSync } from "node:fs";
  import { createAssistantMessageEventStream } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai"))};
  const waitForFile = async (name, signal) => {
    while (!existsSync(${JSON.stringify(dir)} + "/" + name) && !signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  export default function(pi) {
    pi.registerProvider("command-test", {
      baseUrl: "http://127.0.0.1:1", apiKey: "fixture-key", api: "openai-completions",
      streamSimple: (model, context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          await waitForFile("finish", options?.signal);
          const message = {
            role: "assistant", content: [{ type: "text", text: "done" }],
            api: model.api, provider: model.provider, model: model.id,
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop", timestamp: Date.now(),
          };
          stream.push({ type: "done", reason: "stop", message });
          stream.end();
        })();
        return stream;
      },
      models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
    });
    pi.registerCommand("return-now", { handler: async () => {
      pi.appendEntry("command-handled", {});
    } });
    pi.on("input", (event) => event.text === "handled input" ? { action: "handled" } : undefined);
    pi.on("before_agent_start", async (event) => {
      if (event.prompt === "slow start") {
        writeFileSync(${JSON.stringify(join(dir, "preflight"))}, "ready");
        await waitForFile("start");
      }
    });
  }`,
  );
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
  vi.stubEnv(
    PI_BRIDGE_ARGS_ENV,
    JSON.stringify([
      join(
        dirname(
          fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
        ),
        "cli.js",
      ),
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--extension",
      commandPath,
    ]),
  );
  const events: string[] = [];
  const onDone = vi.fn();
  const session = new PiRpcSession(
    {
      cwd: dir,
      model: { provider: "command-test", id: "fixture" },
      sessionFilePath: join(dir, "session.jsonl"),
      sessionDir: dir,
      scratchDir: dir,
      extensionPath,
      recordThreadId: "thr_command_settlement",
      shellEnvOverrides: { PI_CODING_AGENT_DIR: agentDir },
      noSession: true,
    },
    async () => ({ content: "" }),
    (event) => events.push(event.type),
    onDone,
  );
  try {
    await session.start();
    for (const text of ["/return-now", "handled input", "/return-now"]) {
      const dispatch = session.prompt(text);
      await dispatch.consumed;
      let outcome: PiPromptRunOutcome | null | "pending" = "pending";
      void dispatch.settled.then((value) => {
        outcome = value;
      });
      await expect.poll(() => outcome, { timeout: 2000 }).toEqual({});
      expect((await session.getState()).isStreaming).toBe(false);
    }
    expect(events).not.toContain("agent_start");
    expect(events).not.toContain("agent_end");

    const dispatch = session.prompt("slow start");
    let consumed = false;
    let settled = false;
    void dispatch.consumed.then(() => {
      consumed = true;
    });
    void dispatch.settled.then(() => {
      settled = true;
    });
    await expect.poll(() => existsSync(join(dir, "preflight"))).toBe(true);
    expect(consumed).toBe(false);
    expect(settled).toBe(false);
    const probe = vi
      .spyOn(session, "getState")
      .mockRejectedValueOnce(new Error("get_state timed out"));
    writeFileSync(join(dir, "start"), "go");
    await dispatch.consumed;
    expect(probe).toHaveBeenCalledTimes(1);
    expect((await session.getState()).isStreaming).toBe(true);
    expect(settled).toBe(false);
    expect(onDone).not.toHaveBeenCalled();

    const queued = session.prompt("queued follow-up");
    await expect(queued.settled).resolves.toBeNull();
    expect(settled).toBe(false);
    writeFileSync(join(dir, "finish"), "go");
    await expect(dispatch.settled).resolves.toEqual({});
    await queued.consumed;
    await expect
      .poll(async () => (await session.getState()).isStreaming)
      .toBe(false);
    expect(events).toContain("agent_start");
    expect(events).toContain("agent_end");
    expect(onDone).not.toHaveBeenCalled();

    let releaseProbe: () => void = () => undefined;
    probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseProbe = () => {
            resolve({ isStreaming: false, isCompacting: false });
          };
        }),
    );
    const completed = session.prompt("finish despite hanging probe");
    await completed.consumed;
    let completedOutcome: PiPromptRunOutcome | null | "pending" = "pending";
    void completed.settled.then((outcome) => {
      completedOutcome = outcome;
    });
    try {
      await expect.poll(() => completedOutcome, { timeout: 2000 }).toEqual({});
    } finally {
      releaseProbe();
    }
    await expect(session.prompt("/return-now").settled).resolves.toEqual({});
    expect(onDone).not.toHaveBeenCalled();
  } finally {
    writeFileSync(join(dir, "start"), "go");
    writeFileSync(join(dir, "finish"), "go");
    await session.closeGracefully(1000);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
