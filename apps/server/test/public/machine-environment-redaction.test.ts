import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createConnection, migrate } from "@bb/db";
import { threadEventSchema, type ThreadEvent } from "@bb/domain";
import { createScriptedEchoRuntime } from "@bb/agent-runtime/test";
import type { AgentRuntimeExecutionOptions } from "@bb/agent-runtime";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  resolveUserMachineEnvironment,
  updateMachineEnvironment,
} from "../../src/services/machines/environment-settings.js";

const options: AgentRuntimeExecutionOptions = {
  model: "test-model",
  serviceTier: "default",
  reasoningLevel: "medium",
  providerOptions: {},
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};

async function withStoredSecret(
  value: string,
  run: (
    entries: Awaited<ReturnType<typeof resolveUserMachineEnvironment>>,
    dir: string,
  ) => Promise<void>,
) {
  const db = createConnection(":memory:");
  migrate(db);
  const dir = await mkdtemp(join(tmpdir(), "bb-redaction-review-"));
  try {
    await updateMachineEnvironment(db, dir, "TEST_SECRET", {
      name: "TEST_SECRET",
      value,
      note: null,
    });
    await run(await resolveUserMachineEnvironment(db, dir), dir);
  } finally {
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function echoSecret(
  secret: string,
  beforeAck = false,
): Promise<ThreadEvent[]> {
  const events: ThreadEvent[] = [];
  const stderr: string[] = [];
  let acknowledged = false;
  let earlyDeltas = 0;
  await withStoredSecret(secret, async (contributedEnv, workspacePath) => {
    let complete: () => void = () => {};
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath,
        onStderr: (line) => stderr.push(line),
        onEvent: (event) => {
          events.push(event);
          if (!acknowledged && event.type === "item/agentMessage/delta")
            earlyDeltas += 1;
          if (event.type === "turn/completed") complete();
        },
      },
      launch: {
        scripted: {
          textDeltaChunkSize: 20,
          turnStartResponseDelayMs: beforeAck ? 1000 : undefined,
          stderrChunksOnTurn: [secret.slice(0, 7), secret.slice(7) + "\n"],
        },
      },
    });
    try {
      await runtime.startThread({
        environmentId: "env-review",
        projectId: "project-review",
        threadId: "type",
        providerId: "fake",
        options,
        contributedEnv: beforeAck ? [] : contributedEnv,
      });
      await runtime.runTurn({
        threadId: "type",
        clientRequestId: "creq_222222224c",
        input: [{ type: "text", text: secret, mentions: [] }],
        options,
        contributedEnv,
      });
      acknowledged = true;
      if (beforeAck) expect(earlyDeltas).toBeGreaterThan(0);
      await completed;
      await vi.waitFor(() => expect(stderr.join("")).toContain("[redacted]"));
      expect(stderr.join("")).not.toContain(secret);
    } finally {
      await runtime.shutdown();
    }
  });
  return events;
}

it("holds the stored token prefix across the reviewer's ghp_FAK and E_REVIEW_TOKEN deltas", async () => {
  const events = await echoSecret("ghp_FAKE_REVIEW_TOKEN");
  const deltas = events.flatMap((event) =>
    event.type === "item/agentMessage/delta" ? [event.delta] : [],
  );
  expect(deltas.join("")).toBe("Response to: [redacted]");
  expect(JSON.stringify(events)).not.toContain("ghp_FAK");
  expect(JSON.stringify(events)).not.toContain("E_REVIEW_TOKEN");
  expect(events.some((event) => event.type === "turn/completed")).toBe(true);
}, 15_000);

it("redacts the stored secret type without changing protocol keys or identifiers or crashing", async () => {
  const events = await echoSecret("type");
  expect(
    events.every((event) => threadEventSchema.safeParse(event).success),
  ).toBe(true);
  expect(events.every((event) => event.threadId === "type")).toBe(true);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "item/completed",
      item: expect.objectContaining({
        type: "agentMessage",
        text: "Response to: [redacted]",
      }),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: "turn/completed", status: "completed" }),
  );
}, 15_000);

it("redacts a newly configured secret before the provider acknowledges the turn", async () => {
  const events = await echoSecret("ghp_ROTATED_REVIEW_TOKEN", true);
  expect(JSON.stringify(events)).not.toContain("ghp_ROTATED");
  expect(JSON.stringify(events)).not.toContain("REVIEW_TOKEN");
});

it.each(["first-line\nsecond-line", "first-line\r\nsecond-line"])(
  "redacts a stored multiline secret after real node-pty CRLF conversion at every chunk boundary: %j",
  async (secret) => {
    await withStoredSecret(secret, async (entries, dir) => {
      const value = entries.find(
        (entry) => entry.name === "TEST_SECRET",
      )?.value;
      expect(typeof value).toBe("string");
      if (typeof value !== "string") throw new Error("Missing stored secret");
      const script = `
      import { spawn } from 'node-pty';
      import { createSecretStreamRedactor } from '@bb/process-utils';
      const secret = process.env.TEST_SECRET;
      const child = spawn('/bin/sh', ['-c', 'printf "%s\\\\n" "$TEST_SECRET"'], {name:'xterm-color', cols:80, rows:24, cwd:process.env.TEST_WORKSPACE, env:{PATH:'/usr/bin:/bin', TEST_SECRET:secret}});
      let raw = '';
      const live = createSecretStreamRedactor([secret]);
      let output = '';
      child.onData(data => { raw += data; output += live.push(data); });
      child.onExit(() => {
        output += live.flush();
        const outputs = Array.from({length: raw.length + 1}, (_, index) => {
          const redactor = createSecretStreamRedactor([secret]);
          return redactor.push(raw.slice(0,index)) + redactor.push(raw.slice(index)) + redactor.flush();
        });
        console.log(JSON.stringify({raw, output, outputs}));
      });
    `;
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--conditions=source",
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          script,
        ],
        {
          cwd: fileURLToPath(new URL("../../../host-daemon/", import.meta.url)),
          env: { ...process.env, TEST_SECRET: value, TEST_WORKSPACE: dir },
          timeout: 10_000,
        },
      );
      const proof = z
        .object({
          raw: z.string(),
          output: z.string(),
          outputs: z.array(z.string()),
        })
        .parse(JSON.parse(result.stdout));
      expect(proof.raw).toBe(secret.replaceAll("\n", "\r\n") + "\r\n");
      expect(proof.output).toBe("[redacted]\r\n");
      expect(new Set(proof.outputs)).toEqual(new Set(["[redacted]\r\n"]));
    });
  },
  15_000,
);
