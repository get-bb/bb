import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

afterEach(() => vi.unstubAllEnvs());

it.each([
  "accept",
  "decline",
  "cancel",
  "runtime-error",
  "stop",
  "foreign-thread",
  "disconnect",
  "failed-stop",
] as const)(
  "delivers MCP elicitation and returns the user's %s decision",
  async (action) => {
    const workspace = mkdtempSync(join(tmpdir(), "bb-codex-elicitation-"));
    const scriptPath = join(workspace, "script.json");
    const responseLogPath = join(workspace, "responses.jsonl");
    const threadId = "thr_elicitation";
    writeFileSync(
      scriptPath,
      JSON.stringify({
        responseLogPath,
        processLogPath: join(workspace, "processes.log"),
        turns: [
          [
            {
              kind: "request",
              method: "mcpServer/elicitation/request",
              ...(action === "foreign-thread"
                ? {
                    rawParams: {
                      threadId: "another-thread",
                      serverName: "cua_repl",
                      mode: "form",
                      message: "Allow?",
                      requestedSchema: { type: "object", properties: {} },
                    },
                  }
                : {}),
              params: {
                threadId: "codex-thread",
                turnId: null,
                serverName: "cua_repl",
                mode: "form",
                message: 'Allow Computer Use to use "bb"?',
                requestedSchema: { type: "object", properties: {} },
                _meta: {
                  persist: ["session", "always"],
                  riskLevel: "high",
                  subtitle: "App access",
                },
              },
            },
          ],
        ],
      }),
    );
    if (action === "failed-stop") {
      const script = JSON.parse(readFileSync(scriptPath, "utf8"));
      script.interruptError = { code: -32000, message: "Interrupt failed" };
      script.turns[0].push(script.turns[0][0]);
      writeFileSync(scriptPath, JSON.stringify(script));
    }
    stubFakeCodexAppServer(scriptPath);
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    try {
      bridge.sendRequest(1, "thread/start", {
        threadId,
        cwd: workspace,
        instructionMode: "append",
        options: FULL_ACCESS_SESSION_OPTIONS,
      });
      const start = await bridge.waitForResponse(1);
      const providerThreadId = (start.result as { providerThreadId: string })
        .providerThreadId;
      bridge.sendRequest(2, "turn/start", {
        threadId,
        providerThreadId,
        input: [{ type: "text", text: "Ask", mentions: [] }],
        clientRequestId: "creq_a2b3c4d5e6",
        options: FULL_ACCESS_SESSION_OPTIONS,
      });
      if (action === "foreign-thread") {
        await vi.waitFor(() =>
          expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe(""),
        );
        expect(
          JSON.parse(readFileSync(responseLogPath, "utf8").trim()),
        ).toMatchObject({
          error: { code: -32602, message: expect.stringMatching(/thread/i) },
        });
        expect(
          bridge.messages.some((m) => m.method === "interaction/request"),
        ).toBe(false);
        return;
      }
      await vi.waitFor(() =>
        expect(
          bridge.messages.some((m) => m.method === "interaction/request"),
        ).toBe(true),
      );
      const request = bridge.messages.find(
        (m) => m.method === "interaction/request",
      )!;
      expect(request.params).toMatchObject({
        threadId,
        providerThreadId,
        turnId: null,
        providerNativeIds: true,
        payload: {
          kind: "provider-codex/mcp-elicitation",
          data: { message: 'Allow Computer Use to use "bb"?' },
        },
      });
      expect(
        existsSync(responseLogPath)
          ? readFileSync(responseLogPath, "utf8").trim()
          : "",
      ).toBe("");
      if (action === "failed-stop") {
        bridge.sendRequest(3, "thread/stop", {
          threadId,
          providerThreadId,
          intent: "interrupt",
          activeTurnId: "turn-1",
        });
        expect(await bridge.waitForResponse(3)).toMatchObject({
          error: { message: "Interrupt failed" },
        });
        await vi.waitFor(() =>
          expect(
            bridge.messages.filter((m) => m.method === "interaction/request"),
          ).toHaveLength(2),
        );
        const next = bridge.messages.filter(
          (m) => m.method === "interaction/request",
        )[1]!;
        handleLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: next.id,
            result: { kind: "request_answer", value: { action: "decline" } },
          }),
        );
        await vi.waitFor(() =>
          expect(
            readFileSync(responseLogPath, "utf8").trim().split("\n"),
          ).toHaveLength(2),
        );
        expect(
          JSON.parse(
            readFileSync(responseLogPath, "utf8").trim().split("\n")[1]!,
          ).result,
        ).toEqual({ action: "decline", content: null, _meta: null });
        return;
      }
      if (action === "disconnect") {
        const pid = Number(
          readFileSync(join(workspace, "processes.log"), "utf8")
            .split("\n")[0]!
            .split(":")[1],
        );
        process.kill(pid, "SIGKILL");
        await vi.waitFor(() =>
          expect(bridge.messages.some((m) => m.method === "error")).toBe(true),
        );
        handleLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              kind: "request_answer",
              value: { action: "accept", content: {}, persist: "always" },
            },
          }),
        );
        bridge.sendRequest(4, "thread/start", {
          threadId,
          cwd: workspace,
          instructionMode: "append",
          options: FULL_ACCESS_SESSION_OPTIONS,
        });
        const restarted = await bridge.waitForResponse(4);
        const restartedId = (restarted.result as { providerThreadId: string })
          .providerThreadId;
        bridge.sendRequest(5, "turn/start", {
          threadId,
          providerThreadId: restartedId,
          input: [{ type: "text", text: "Ask again", mentions: [] }],
          clientRequestId: "creq_a2b3c4d5e7",
          options: FULL_ACCESS_SESSION_OPTIONS,
        });
        await vi.waitFor(() =>
          expect(
            bridge.messages.filter((m) => m.method === "interaction/request"),
          ).toHaveLength(2),
        );
        const second = bridge.messages.filter(
          (m) => m.method === "interaction/request",
        )[1]!;
        expect(second.id).not.toBe(request.id);
        expect(
          existsSync(responseLogPath)
            ? readFileSync(responseLogPath, "utf8").trim()
            : "",
        ).toBe("");
        handleLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: second.id,
            result: { kind: "request_answer", value: { action: "decline" } },
          }),
        );
        await vi.waitFor(() =>
          expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe(""),
        );
        expect(
          JSON.parse(readFileSync(responseLogPath, "utf8").trim()).result,
        ).toEqual({ action: "decline", content: null, _meta: null });
        return;
      }
      if (action === "stop") {
        bridge.sendRequest(3, "thread/stop", {
          threadId,
          providerThreadId,
          intent: "release",
          activeTurnId: null,
        });
        await bridge.waitForResponse(3);
      } else
        handleLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            ...(action === "runtime-error"
              ? { error: { code: -32000, message: "Request interrupted" } }
              : {
                  result: {
                    kind: "request_answer",
                    value:
                      action === "accept"
                        ? { action, content: {}, persist: "session" }
                        : { action },
                  },
                }),
          }),
        );
      await vi.waitFor(() =>
        expect(readFileSync(responseLogPath, "utf8").trim()).not.toBe(""),
      );
      expect(JSON.parse(readFileSync(responseLogPath, "utf8").trim())).toEqual({
        jsonrpc: "2.0",
        id: "fx-req-1",
        result: {
          action:
            action === "runtime-error" || action === "stop" ? "cancel" : action,
          content: action === "accept" ? {} : null,
          _meta: action === "accept" ? { persist: "session" } : null,
        },
      });
    } finally {
      bridge.sendRequest(999, "thread/stop", {
        threadId,
        providerThreadId: "codex-thread",
        intent: "release",
        activeTurnId: null,
      });
      await bridge.waitForResponse(999).catch(() => undefined);
      bridge.restore();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  30_000,
);
