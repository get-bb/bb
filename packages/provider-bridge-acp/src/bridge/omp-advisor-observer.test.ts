import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadDelta } from "@bb/provider-bridge-protocol";
import {
  createOmpAdvisorTranscriptObserver,
  type OmpAdvisorTranscriptObserver,
} from "./omp-advisor-observer.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bb-omp-advisor-"));
  roots.push(root);
  return root;
}

function appendEntries(path: string, entries: readonly unknown[]): void {
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
  writeFileSync(path, `${text}\n`, { flag: "a" });
}

function sessionUpdate(id: string): unknown {
  return {
    type: "message",
    id,
    message: {
      role: "user",
      content: [{ type: "text", text: "### Session update" }],
    },
  };
}

function advisorContext(id: string): unknown {
  return {
    type: "message",
    id,
    message: {
      role: "user",
      content: [{ type: "text", text: "**agent**:" }],
    },
  };
}

function advisorResponse(args: {
  id: string;
  model: string;
  provider: string;
  content: readonly unknown[];
  stopReason: string;
  errorMessage?: string;
}): unknown {
  return {
    type: "message",
    id: args.id,
    message: {
      role: "assistant",
      content: args.content,
      provider: args.provider,
      model: args.model,
      stopReason: args.stopReason,
      ...(args.errorMessage === undefined
        ? {}
        : { errorMessage: args.errorMessage }),
    },
  };
}

function observerFixture(
  advisorFileName = "__advisor.jsonl",
  ignoreExisting = false,
): {
  artifactDir: string;
  deltas: ThreadDelta[];
  observer: OmpAdvisorTranscriptObserver;
  transcriptPath: string;
} {
  const root = temporaryRoot();
  const sessionDir = join(root, "sessions");
  const artifactDir = join(
    sessionDir,
    "2026-09-02T00-00-00-000Z_provider-session",
  );
  mkdirSync(artifactDir, { recursive: true });
  const transcriptPath = join(artifactDir, advisorFileName);
  const deltas: ThreadDelta[] = [];
  const observer = createOmpAdvisorTranscriptObserver({
    providerThreadId: "provider-session",
    cwd: root,
    env: {},
    ignoreExisting,
    sessionDir,
    pollIntervalMs: null,
    emit: (next) => deltas.push(...next),
  });
  return { artifactDir, deltas, observer, transcriptPath };
}

function lastClose(deltas: readonly ThreadDelta[]): ThreadDelta | undefined {
  for (let index = deltas.length - 1; index >= 0; index -= 1) {
    const delta = deltas[index];
    if (delta?.kind === "item.close") {
      return delta;
    }
  }
  return undefined;
}

describe("OMP advisor transcript observer", () => {
  it("shows a pending review, then its note and exact model", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();

    appendEntries(transcriptPath, [sessionUpdate("review-1")]);
    await observer.poll();

    expect(deltas).toEqual([
      expect.objectContaining({
        kind: "item.open",
        key: { providerItemId: "omp-advisor:default:review-1" },
        item: expect.objectContaining({
          type: "extension",
          kind: "provider-acp/advisor",
          payload: expect.objectContaining({
            advisor: "default",
            model: null,
            output: null,
          }),
        }),
        presentation: expect.objectContaining({
          label: {
            pending: "Advisor reviewing",
            completed: "Advisor reviewed",
          },
        }),
      }),
    ]);

    appendEntries(transcriptPath, [
      advisorResponse({
        id: "response-1",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "advise",
            arguments: { note: "Keep the existing API.", severity: "concern" },
          },
        ],
      }),
    ]);
    await observer.poll();

    expect(lastClose(deltas)).toEqual(
      expect.objectContaining({
        kind: "item.close",
        key: { providerItemId: "omp-advisor:default:review-1" },
        status: "completed",
        item: expect.objectContaining({
          type: "extension",
          kind: "provider-acp/advisor",
          payload: {
            advisor: "default",
            provider: "anthropic",
            model: "claude-fable-5-1",
            output: "**Concern:** Keep the existing API.",
            notes: [{ note: "Keep the existing API.", severity: "concern" }],
          },
        }),
        presentation: expect.objectContaining({
          title: "anthropic/claude-fable-5-1",
          detail: "**Concern:** Keep the existing API.",
        }),
      }),
    );
    expect(deltas.map((delta) => delta.kind)).toEqual([
      "item.open",
      "item.close",
    ]);
  });

  it("does not treat OMP context messages as separate reviews", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();
    appendEntries(transcriptPath, [
      sessionUpdate("review-context"),
      advisorContext("context-message"),
      advisorResponse({
        id: "response-context",
        provider: "openrouter",
        model: "anthropic/claude-opus-4.8",
        stopReason: "stop",
        content: [{ type: "text", text: "Silent — no concerns." }],
      }),
    ]);
    await observer.poll();

    expect(deltas.filter((delta) => delta.kind === "item.open")).toHaveLength(
      1,
    );
    expect(lastClose(deltas)).toMatchObject({
      status: "completed",
      item: { payload: { output: "Silent — no concerns." } },
    });
  });

  it("marks a superseded advisor review as interrupted", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();
    appendEntries(transcriptPath, [
      sessionUpdate("review-superseded"),
      advisorResponse({
        id: "response-reading",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "toolUse",
        content: [{ type: "toolCall", name: "grep", arguments: {} }],
      }),
      sessionUpdate("review-next"),
    ]);
    await observer.poll();

    const interrupted = deltas.find(
      (delta) => delta.kind === "item.close" && delta.status === "interrupted",
    );
    expect(interrupted).toMatchObject({
      presentation: {
        label: { completed: "Advisor stopped" },
        detail: "Advisor review stopped before responding.",
      },
    });
  });

  it("closes a pending review when the main turn ends", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();
    appendEntries(transcriptPath, [sessionUpdate("review-ending")]);
    await observer.poll();

    observer.finishTurn();

    expect(lastClose(deltas)).toMatchObject({
      status: "interrupted",
      presentation: {
        label: { completed: "Advisor stopped" },
        detail: "Advisor review stopped before responding.",
      },
    });
  });

  it("shows a silent named advisor review", async () => {
    const { deltas, observer, transcriptPath } = observerFixture(
      "__advisor.security.jsonl",
    );
    await observer.start();
    appendEntries(transcriptPath, [
      sessionUpdate("review-2"),
      advisorResponse({
        id: "response-3",
        provider: "openrouter",
        model: "anthropic/claude-opus-4.8",
        stopReason: "stop",
        content: [{ type: "text", text: "Silent — no concerns." }],
      }),
    ]);
    await observer.poll();

    expect(lastClose(deltas)).toEqual(
      expect.objectContaining({
        kind: "item.close",
        status: "completed",
        item: expect.objectContaining({
          payload: expect.objectContaining({
            advisor: "security",
            provider: "openrouter",
            model: "anthropic/claude-opus-4.8",
            output: "Silent — no concerns.",
            notes: [],
          }),
        }),
      }),
    );
  });

  it("marks an advisor model error as failed", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();
    appendEntries(transcriptPath, [
      sessionUpdate("review-3"),
      advisorResponse({
        id: "response-4",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "error",
        errorMessage: "Quota exhausted",
        content: [],
      }),
    ]);
    await observer.poll();

    expect(lastClose(deltas)).toEqual(
      expect.objectContaining({
        kind: "item.close",
        status: "failed",
        presentation: expect.objectContaining({
          label: {
            pending: "Advisor reviewing",
            completed: "Advisor failed",
          },
          detail: "Quota exhausted",
        }),
      }),
    );
  });

  it("keeps full output in the payload and bounds the fallback detail", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    const output = "Long advisor output ".repeat(40);
    await observer.start();
    appendEntries(transcriptPath, [
      sessionUpdate("review-long"),
      advisorResponse({
        id: "response-long",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "stop",
        content: [{ type: "text", text: output }],
      }),
    ]);
    await observer.poll();

    expect(lastClose(deltas)).toMatchObject({
      item: { payload: { output: output.trim() } },
      presentation: { detail: expect.any(String) },
    });
    const close = lastClose(deltas);
    expect(
      close?.kind === "item.close" ? close.presentation?.detail?.length : 0,
    ).toBe(280);
  });

  it("does not replay reviews already present when a session resumes", async () => {
    const { deltas, observer, transcriptPath } = observerFixture(
      "__advisor.jsonl",
      true,
    );
    appendEntries(transcriptPath, [
      sessionUpdate("old-review"),
      advisorResponse({
        id: "old-response",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "stop",
        content: [{ type: "text", text: "Old output" }],
      }),
    ]);

    await observer.start();
    expect(deltas).toEqual([]);

    appendEntries(transcriptPath, [
      sessionUpdate("new-review"),
      advisorResponse({
        id: "new-response",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "stop",
        content: [{ type: "text", text: "New output" }],
      }),
    ]);
    await observer.poll();

    expect(deltas).toHaveLength(2);
    expect(lastClose(deltas)).toEqual(
      expect.objectContaining({
        kind: "item.close",
        item: expect.objectContaining({
          payload: expect.objectContaining({ output: "New output" }),
        }),
      }),
    );
  });

  it("does not replay a resumed transcript discovered after startup", async () => {
    const root = temporaryRoot();
    const sessionDir = join(root, "sessions");
    const artifactDir = join(
      sessionDir,
      "2026-09-02T00-00-00-000Z_provider-session",
    );
    const transcriptPath = join(artifactDir, "__advisor.jsonl");
    const deltas: ThreadDelta[] = [];
    const observer = createOmpAdvisorTranscriptObserver({
      providerThreadId: "provider-session",
      cwd: root,
      env: {},
      sessionDir,
      ignoreExisting: true,
      pollIntervalMs: null,
      emit: (next) => deltas.push(...next),
    });
    await observer.start();
    mkdirSync(artifactDir, { recursive: true });
    appendEntries(transcriptPath, [
      sessionUpdate("old-review"),
      advisorResponse({
        id: "old-response",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "stop",
        content: [{ type: "text", text: "Old output" }],
      }),
    ]);

    await observer.poll();
    expect(deltas).toEqual([]);
    appendEntries(transcriptPath, [
      sessionUpdate("new-review"),
      advisorResponse({
        id: "new-response",
        provider: "anthropic",
        model: "claude-fable-5-1",
        stopReason: "stop",
        content: [{ type: "text", text: "New output" }],
      }),
    ]);
    await observer.poll();

    expect(lastClose(deltas)).toMatchObject({
      item: { payload: { output: "New output" } },
    });
  });

  it("ignores partial and malformed lines without failing the OMP session", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();
    const update = JSON.stringify(sessionUpdate("review-4"));
    const split = Math.floor(update.length / 2);
    writeFileSync(transcriptPath, update.slice(0, split), { flag: "a" });
    await expect(observer.poll()).resolves.toBeUndefined();
    expect(deltas).toEqual([]);

    writeFileSync(
      transcriptPath,
      `${update.slice(split)}\n{"type":"broken"\n`,
      { flag: "a" },
    );
    await expect(observer.poll()).resolves.toBeUndefined();
    expect(deltas).toEqual([
      expect.objectContaining({
        kind: "item.open",
        key: { providerItemId: "omp-advisor:default:review-4" },
      }),
    ]);
  });

  it("preserves multi-byte text split across polls", async () => {
    const { deltas, observer, transcriptPath } = observerFixture();
    await observer.start();
    const transcript = Buffer.from(
      `${JSON.stringify(sessionUpdate("review-unicode"))}\n${JSON.stringify(
        advisorResponse({
          id: "response-unicode",
          provider: "anthropic",
          model: "claude-fable-5-1",
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              name: "advise",
              arguments: { note: "Keep — exact", severity: "concern" },
            },
          ],
        }),
      )}\n`,
    );
    const emDashIndex = transcript.indexOf(Buffer.from("—"));
    expect(emDashIndex).toBeGreaterThan(0);

    writeFileSync(transcriptPath, transcript.subarray(0, emDashIndex + 1), {
      flag: "a",
    });
    await observer.poll();
    writeFileSync(transcriptPath, transcript.subarray(emDashIndex + 1), {
      flag: "a",
    });
    await observer.poll();

    expect(lastClose(deltas)).toMatchObject({
      item: { payload: { output: "**Concern:** Keep — exact" } },
    });
  });

  it("stops scheduled polling", async () => {
    vi.useFakeTimers();
    const { observer } = observerFixture();
    const scheduled = createOmpAdvisorTranscriptObserver({
      providerThreadId: "provider-session",
      cwd: temporaryRoot(),
      env: {},
      sessionDir: temporaryRoot(),
      pollIntervalMs: 50,
      emit: () => undefined,
    });
    await scheduled.start();
    scheduled.stop();
    await vi.advanceTimersByTimeAsync(100);
    observer.stop();
    vi.useRealTimers();
  });
});
