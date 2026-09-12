import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

describe("runtime identity ordering", () => {
  it("preserves resolved fork sessions when native identity deltas arrive in reverse registration order", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-identity-reverse-"));
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath, onEvent: (event) => events.push(event) },
      launch: {
        scripted: {
          identityNotificationsBeforeTurn: [
            { threadId: "second", providerThreadId: "prov-2", asDelta: true },
            { threadId: "first", providerThreadId: "prov-1", asDelta: true },
          ],
        },
      },
    });
    try {
      for (const threadId of ["first", "second"]) {
        await runtime.startThread({
          environmentId: "env",
          projectId: "project",
          providerId: "fake",
          options: fullRuntimeOptions,
          threadId,
          fork: { sourceProviderThreadId: "historical-session" },
        });
      }
      await runtime.runTurn({
        threadId: "second",
        clientRequestId: "creq_222222222e",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({ events, runtime, threadId: "second" });
      expect(runtime.getProviderSession("first")?.providerThreadId).toBe(
        "prov-1",
      );
      expect(runtime.getProviderSession("second")?.providerThreadId).toBe(
        "prov-2",
      );
      expect(
        events.find((event) => event.type === "turn/completed"),
      ).toMatchObject({ threadId: "second", providerThreadId: "prov-2" });
    } finally {
      await runtime.shutdown();
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it.each([false, true])(
    "preserves source/fork ownership with identityAfterResponse=%s and duplicate or unknown notifications",
    async (identityAfterResponse) => {
      const workspacePath = mkdtempSync(
        join(tmpdir(), "bb-identity-ordering-"),
      );
      const events: ThreadEvent[] = [];
      const runtime = createScriptedEchoRuntime({
        runtime: { workspacePath, onEvent: (event) => events.push(event) },
        launch: {
          scripted: {
            identityAfterResponse,
            identityNotificationsBeforeTurn: [
              { threadId: "prov-2", providerThreadId: "prov-2" },
              { threadId: "unknown", providerThreadId: "foreign-session" },
              { threadId: "fork", providerThreadId: "prov-2" },
            ],
          },
        },
      });
      const args = {
        environmentId: "env",
        projectId: "project",
        providerId: "fake",
        options: fullRuntimeOptions,
      };
      try {
        const source = await runtime.startThread({
          ...args,
          threadId: "source",
        });
        const fork = await runtime.startThread({
          ...args,
          threadId: "fork",
          fork: { sourceProviderThreadId: source.providerThreadId },
        });
        for (const threadId of ["source", "fork"]) {
          await runtime.runTurn({
            threadId,
            clientRequestId:
              threadId === "source" ? "creq_222222222a" : "creq_222222222b",
            input: [promptTextInput({ text: "hello" })],
            options: fullRuntimeOptions,
          });
          await waitForThreadTurnCompleted({ events, runtime, threadId });
        }
        expect(runtime.getProviderSession("source")?.providerThreadId).toBe(
          source.providerThreadId,
        );
        expect(runtime.getProviderSession("fork")?.providerThreadId).toBe(
          fork.providerThreadId,
        );
        expect(
          events.filter((event) => event.type === "turn/completed"),
        ).toMatchObject([
          { threadId: "source", providerThreadId: source.providerThreadId },
          { threadId: "fork", providerThreadId: fork.providerThreadId },
        ]);
        expect(
          events.some(
            (event) =>
              "providerThreadId" in event &&
              event.providerThreadId === "foreign-session",
          ),
        ).toBe(false);
      } finally {
        await runtime.shutdown();
        rmSync(workspacePath, { recursive: true, force: true });
      }
    },
  );

  it("does not assign a retired thread's late identity to the only remaining thread", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-identity-late-"));
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath, onEvent: (event) => events.push(event) },
      launch: {
        scripted: {
          identityNotificationsBeforeTurn: [
            { threadId: "retired", providerThreadId: "prov-1" },
          ],
        },
      },
    });
    const args = {
      environmentId: "env",
      projectId: "project",
      providerId: "fake",
      options: fullRuntimeOptions,
    };
    try {
      await runtime.startThread({ ...args, threadId: "retired" });
      const remaining = await runtime.startThread({
        ...args,
        threadId: "remaining",
      });
      await runtime.stopThread({ threadId: "retired" });
      const start = events.length;
      await runtime.runTurn({
        threadId: "remaining",
        clientRequestId: "creq_222222222c",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        runtime,
        threadId: "remaining",
      });
      expect(
        events.slice(start).filter((event) => event.type === "thread/identity"),
      ).toEqual([]);
      expect(runtime.getProviderSession("remaining")?.providerThreadId).toBe(
        remaining.providerThreadId,
      );
    } finally {
      await runtime.shutdown();
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("stamps a completion before applying the following scoped replacement identity in the same batch", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "bb-identity-batch-"));
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath, onEvent: (event) => events.push(event) },
      launch: { scripted: { completionIdentity: "replacement-session" } },
    });
    try {
      const original = await runtime.startThread({
        environmentId: "env",
        projectId: "project",
        providerId: "fake",
        options: fullRuntimeOptions,
        threadId: "source",
      });
      await runtime.runTurn({
        threadId: "source",
        clientRequestId: "creq_222222222d",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({ events, runtime, threadId: "source" });
      expect(
        events.find((event) => event.type === "turn/completed"),
      ).toMatchObject({ providerThreadId: original.providerThreadId });
      expect(events.at(-1)).toMatchObject({
        type: "thread/identity",
        providerThreadId: "replacement-session",
        threadId: "source",
      });
      expect(runtime.getProviderSession("source")?.providerThreadId).toBe(
        "replacement-session",
      );
    } finally {
      await runtime.shutdown();
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
