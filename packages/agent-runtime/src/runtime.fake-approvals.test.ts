import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
  ThreadEvent,
} from "@bb/domain";
import { promptTextInput } from "./test/prompt-input.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import { createFakeAdapter } from "./test/fake-adapter.js";
import {
  fullRuntimeOptions,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";

// The `approve:<kind>` control token is the deterministic approval path the
// mobile e2e flows drive against the fake provider. These tests pin the
// request the runtime hands to `onInteractiveRequest` and the two ways the
// fake turn resumes afterwards.
describe("fake provider approve:<kind> control token", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-fake-approval-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runApprovalTurn(args: {
    prompt: string;
    resolve: (
      request: PendingInteractionCreate,
    ) => PendingInteractionResolution;
  }): Promise<{
    events: ThreadEvent[];
    requests: PendingInteractionCreate[];
    shutdown: () => Promise<void>;
  }> {
    const events: ThreadEvent[] = [];
    const requests: PendingInteractionCreate[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      onInteractiveRequest: async (request) => {
        requests.push(request);
        return args.resolve(request);
      },
      adapterFactory: () => createFakeAdapter(),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_fakeapprv2",
      threadId: "t1",
      input: [promptTextInput({ text: args.prompt })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnCompleted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });

    return { events, requests, shutdown: () => runtime.shutdown() };
  }

  it("emits a command approval and echoes the response after allow_once", async () => {
    const { events, requests, shutdown } = await runApprovalTurn({
      prompt: "approve:command hello",
      resolve: () => ({ decision: "allow_once", grantedPermissions: null }),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      threadId: "t1",
      turnId: "turn-1",
      providerId: "fake",
      providerThreadId: "prov-1",
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          command: "echo hi",
          cwd: null,
          actions: [],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "fake",
      text: "Response to: approve:command hello",
      threadId: "t1",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({ type: "agentMessage", text: "Denied" }),
      }),
    );
    await shutdown();
  });

  it("completes the turn with Denied when the approval is denied", async () => {
    const { events, requests, shutdown } = await runApprovalTurn({
      prompt: "approve:command hello",
      resolve: () => ({ decision: "deny" }),
    });

    expect(requests).toHaveLength(1);
    await waitForThreadAgentMessageText({
      events,
      providerId: "fake",
      text: "Denied",
      threadId: "t1",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          text: "Response to: approve:command hello",
        }),
      }),
    );
    await shutdown();
  });

  it.each([
    {
      kind: "file_change",
      subject: { kind: "file_change", writeScope: null, sessionGrant: null },
      reason: "Write src/example.ts",
    },
    {
      kind: "permission_grant",
      subject: {
        kind: "permission_grant",
        toolName: "Edit",
        permissions: {
          network: null,
          fileSystem: { read: [], write: ["src/example.ts"] },
        },
      },
      reason: null,
    },
    {
      kind: "plan",
      subject: { kind: "plan", planFilePath: null },
      reason: null,
    },
  ])("decodes approve:$kind into a $kind approval subject", async (fixture) => {
    const { requests, shutdown } = await runApprovalTurn({
      prompt: `approve:${fixture.kind}`,
      resolve: () => ({ decision: "deny" }),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.payload).toMatchObject({
      kind: "approval",
      subject: fixture.subject,
      reason: fixture.reason,
    });
    await shutdown();
  });
});
