import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_killAllChildrenForTests, handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

it("resolves selected skills for both turn start and steering through the app-server catalog", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bb-codex-skill-input-"));
  const log = join(cwd, "requests.jsonl");
  const script = join(cwd, "script.json");
  const skillPath = join(cwd, ".agents", "skills", "teach", "SKILL.md");
  writeFileSync(
    script,
    JSON.stringify({
      requestLogPath: log,
      skillsList: {
        data: [
          { cwd, skills: [{ name: "teach", path: skillPath, enabled: true }] },
        ],
      },
    }),
  );
  stubFakeCodexAppServer(script);
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  const threadId = "thr_skill_input_1";
  try {
    harness.sendRequest(1, "thread/start", {
      threadId,
      cwd,
      instructionMode: "append",
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    const started = await harness.waitForResponse(1);
    expect(started.error).toBeUndefined();
    const { providerThreadId } = z
      .object({ providerThreadId: z.string() })
      .parse(started.result);
    const selection = {
      type: "text",
      text: "/teach",
      mentions: [
        {
          start: 0,
          end: 6,
          resource: {
            kind: "command",
            trigger: "/",
            source: "skill",
            origin: "project",
            name: "teach",
            label: "teach",
            argumentHint: null,
          },
        },
      ],
    };
    harness.sendRequest(2, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_2345678923",
      input: [
        { type: "text", text: "/wait-for-interrupt", mentions: [] },
        selection,
      ],
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    expect((await harness.waitForResponse(2)).error).toBeUndefined();
    harness.sendRequest(3, "turn/steer", {
      threadId,
      providerThreadId,
      expectedTurnId: "turn-fx-1",
      clientRequestId: "creq_2345678924",
      input: [selection],
      options: FULL_ACCESS_SESSION_OPTIONS,
    });
    expect((await harness.waitForResponse(3)).error).toBeUndefined();
    const requests = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) =>
        z
          .object({
            method: z.string(),
            params: z.record(z.string(), z.unknown()),
          })
          .parse(JSON.parse(line)),
      );
    expect(
      requests
        .filter((request) => request.method === "skills/list")
        .map((request) => request.params),
    ).toEqual([
      { cwds: [cwd], forceReload: true },
      { cwds: [cwd], forceReload: true },
    ]);
    for (const method of ["turn/start", "turn/steer"]) {
      expect(
        requests.find((request) => request.method === method)?.params.input,
      ).toEqual(
        expect.arrayContaining([
          { type: "skill", name: "teach", path: skillPath },
        ]),
      );
    }
  } finally {
    harness.sendRequest(4, "thread/stop", {
      threadId,
      providerThreadId: "skills-cleanup",
      intent: "release",
      activeTurnId: null,
    });
    await harness.waitForResponse(4).catch(() => undefined);
    experimental_killAllChildrenForTests();
    harness.restore();
    vi.unstubAllEnvs();
    rmSync(cwd, { recursive: true, force: true });
  }
});
