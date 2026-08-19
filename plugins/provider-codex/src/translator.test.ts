import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { turnScope, type ThreadEvent } from "@bb/domain";
import type { RuntimePermissionPolicy } from "@bb/domain";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "@bb/agent-runtime/test/bridge-delta-assembly";
import type { ServerNotification as CodexServerNotification } from "./generated/codex-app-server/schema/ServerNotification.js";
import type { Turn } from "./generated/codex-app-server/schema/v2/Turn.js";
import {
  createCodexEventTranslator,
  type CodexEventTranslator,
} from "./translator.js";

/**
 * Codex translation invariants, driven against `createCodexEventTranslator`
 * with app-server events and assembled through a real runtime delta assembler
 * (the exact translation the bridge protocol adapter performs), so every
 * historical fix keeps pinning live end-to-end behavior on the
 * narrow-grammar path. Ids are asserted via the assembler's provider↔bb maps
 * because minting moved off the bridge.
 *
 * Split of responsibility with delta-translation.test.ts: that file holds the
 * per-event translation surface; this one keeps the *stateful* correlation
 * invariants — command-output recovery across event reordering,
 * subagent/delegation parent links, accepted-turn correlation — which need
 * multi-event sequences against one translator instance.
 */

const THREAD_ID = "t-codex-translator";
const ENTROPY = "cxt-test";

function codexEvent<M extends CodexServerNotification["method"]>(
  method: M,
  params: Extract<CodexServerNotification, { method: M }>["params"],
) {
  return { jsonrpc: "2.0" as const, method, params };
}

function codexTurn(args: {
  id: string;
  status: Turn["status"];
  error: Turn["error"];
}): Turn {
  return {
    id: args.id,
    items: [],
    itemsView: "full",
    status: args.status,
    error: args.error,
    startedAt: 0,
    completedAt: null,
    durationMs: null,
  };
}

interface CodexTranslatorHarness {
  assembler: DeltaAssembler;
  translator: CodexEventTranslator;
  translate(event: Parameters<CodexEventTranslator["translateEvent"]>[0]): ThreadEvent[];
  turnId(codexTurnId: string): string;
  itemId(codexItemId: string): string;
}

function createHarness(
  translator = createCodexEventTranslator({ additionalWorkspaceWriteRoots: [] }),
): CodexTranslatorHarness {
  const assembler = createDeltaAssembler({
    providerId: "codex",
    entropyPrefix: ENTROPY,
    // Equivalence suites pin per-delta translation fidelity: no coalescing.
    textDeltaFlushMs: 0,
  });
  return {
    assembler,
    translator,
    translate(event) {
      return assembler.assemble({
        threadId: THREAD_ID,
        deltas: translator.translateEvent(event),
      });
    },
    turnId(codexTurnId) {
      return assembler.getBbTurnId(THREAD_ID, codexTurnId) ?? "";
    },
    itemId(codexItemId) {
      return assembler.getBbItemId(THREAD_ID, codexItemId) ?? "";
    },
  };
}

function createTranslator() {
  return createCodexEventTranslator({ additionalWorkspaceWriteRoots: [] });
}

// ---------------------------------------------------------------------------
// Workspace-write git-root staging lifecycle (a3d1f4a08, #1187)
// ---------------------------------------------------------------------------

const WORKSPACE_ASK_OPTIONS = {
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "ask",
} satisfies RuntimePermissionPolicy;

interface LinkedWorktreeFixture {
  cleanup(): void;
  expectedWritableRoots: string[];
  gitDir: string;
  rootPath: string;
  workspacePath: string;
}

function createLinkedWorktreeFixture(): LinkedWorktreeFixture {
  const rootPath = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "bb-codex-worktree-")),
  );
  const workspacePath = path.join(rootPath, "worktree");
  const commonDir = path.join(rootPath, "repo.git");
  const gitDir = path.join(commonDir, "worktrees", "bb1");
  const headRef = "refs/heads/bb/probe";
  const headRefParent = path.join(commonDir, "refs", "heads", "bb");
  const headLogParent = path.join(commonDir, "logs", "refs", "heads", "bb");

  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(path.join(commonDir, "objects"), { recursive: true });
  mkdirSync(headRefParent, { recursive: true });
  mkdirSync(headLogParent, { recursive: true });
  writeFileSync(path.join(workspacePath, ".git"), `gitdir: ${gitDir}\n`);
  writeFileSync(
    path.join(gitDir, "gitdir"),
    `${path.join(workspacePath, ".git")}\n`,
  );
  writeFileSync(path.join(gitDir, "commondir"), "../..\n");
  writeFileSync(path.join(gitDir, "HEAD"), `ref: ${headRef}\n`);

  return {
    cleanup() {
      rmSync(rootPath, { recursive: true, force: true });
    },
    expectedWritableRoots: [
      gitDir,
      path.join(commonDir, "objects"),
      headRefParent,
      headLogParent,
    ],
    gitDir,
    rootPath,
    workspacePath,
  };
}

function unlinkWorkspaceGitDir(fixture: LinkedWorktreeFixture): void {
  writeFileSync(path.join(fixture.workspacePath, ".git"), "gitdir: /\n");
}

function dedupeRoots(roots: readonly string[]): string[] {
  return [...new Set(roots)];
}

/**
 * The translator has no thread/start vs thread/resume distinction — both build
 * the same `CodexSessionConstructionInput` — so the adapter's separate
 * start-constructed and resume-constructed cases collapse into one lifecycle
 * here.
 */
describe("codex workspace-write git-root staging", () => {
  // The git layout of a linked worktree is probed once, when the session is
  // constructed. Turns must name the roots the session actually started with:
  // re-probing at turn time silently drops write access when the worktree's
  // .git link moves. Staging is two-phase for the mirror-image reason — a
  // construction the provider never accepted must not leak its roots into a
  // turn on some other session.
  it("hands staged roots to the thread only once the construction is accepted", () => {
    const fixture = createLinkedWorktreeFixture();
    const translator = createTranslator();
    try {
      const prepared = translator.prepareWorkspaceWriteGitRoots({
        command: {
          threadId: "bb-thread-1",
          cwd: fixture.workspacePath,
          options: WORKSPACE_ASK_OPTIONS,
        },
      });
      expect(prepared.config).toMatchObject({
        "sandbox_workspace_write.writable_roots": fixture.expectedWritableRoots,
      });

      // Staged is not active.
      expect(translator.getThreadGitWritableRoots("bb-thread-1")).toEqual([]);

      translator.activateThreadGitWritableRoots({
        providerThreadId: "codex-thread-1",
        threadId: "bb-thread-1",
      });
      unlinkWorkspaceGitDir(fixture);

      expect(translator.getThreadGitWritableRoots("bb-thread-1")).toEqual(
        fixture.expectedWritableRoots,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("merges the host's additional workspace roots into the construction config", () => {
    const fixture = createLinkedWorktreeFixture();
    const additionalWorkspaceWriteRoots = [
      path.join(fixture.rootPath, "host-extra-root"),
      fixture.gitDir,
    ];
    const translator = createCodexEventTranslator({
      additionalWorkspaceWriteRoots,
    });
    try {
      const prepared = translator.prepareWorkspaceWriteGitRoots({
        command: {
          threadId: "bb-thread-1",
          cwd: fixture.workspacePath,
          options: WORKSPACE_ASK_OPTIONS,
        },
      });
      expect(prepared.config).toMatchObject({
        "sandbox_workspace_write.writable_roots": dedupeRoots([
          ...additionalWorkspaceWriteRoots,
          ...fixture.expectedWritableRoots,
        ]),
      });

      translator.activateThreadGitWritableRoots({
        providerThreadId: "codex-thread-1",
        threadId: "bb-thread-1",
      });

      // The staged state stays git-only. Turn-time sandbox policy re-applies
      // the host's roots from the same option, so carrying them in the staged
      // set too would double-count them into every later turn.
      expect(translator.getThreadGitWritableRoots("bb-thread-1")).toEqual(
        fixture.expectedWritableRoots,
      );
    } finally {
      fixture.cleanup();
    }
  });

  // Constructions are staged by bb thread id but are only bound to a provider
  // thread id on acceptance, and acceptance order is not construction order.
  // Binding on construction instead cross-wired two concurrently starting
  // sessions — and made `thread/closed`, which only knows the provider id,
  // clear the wrong thread's roots.
  it("binds each construction's roots to its own accepted provider thread id", () => {
    const firstFixture = createLinkedWorktreeFixture();
    const secondFixture = createLinkedWorktreeFixture();
    const translator = createTranslator();
    try {
      for (const [threadId, fixture] of [
        ["bb-thread-1", firstFixture],
        ["bb-thread-2", secondFixture],
      ] as const) {
        translator.prepareWorkspaceWriteGitRoots({
          command: {
            threadId,
            cwd: fixture.workspacePath,
            options: WORKSPACE_ASK_OPTIONS,
          },
        });
      }

      // Interleaved: the second construction is accepted first.
      translator.activateThreadGitWritableRoots({
        providerThreadId: "codex-thread-2",
        threadId: "bb-thread-2",
      });
      translator.activateThreadGitWritableRoots({
        providerThreadId: "codex-thread-1",
        threadId: "bb-thread-1",
      });

      translator.translateEvent(
        codexEvent("thread/closed", { threadId: "codex-thread-1" }),
      );

      expect(translator.getThreadGitWritableRoots("bb-thread-1")).toEqual([]);
      expect(translator.getThreadGitWritableRoots("bb-thread-2")).toEqual(
        secondFixture.expectedWritableRoots,
      );
    } finally {
      firstFixture.cleanup();
      secondFixture.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Raw shell command-output recovery (8e7cc5d2e, #1400)
// ---------------------------------------------------------------------------

function rawShellCall(args: {
  callId: string;
  providerThreadId: string;
  toolName?: string;
  turnId: string;
}) {
  return codexEvent("rawResponseItem/completed", {
    threadId: args.providerThreadId,
    turnId: args.turnId,
    item: {
      type: "function_call",
      name: args.toolName ?? "exec_command",
      arguments: '{"cmd":"echo hi"}',
      call_id: args.callId,
    },
  });
}

function rawShellOutput(args: {
  callId: string;
  output: string;
  providerThreadId: string;
  turnId: string;
}) {
  return codexEvent("rawResponseItem/completed", {
    threadId: args.providerThreadId,
    turnId: args.turnId,
    item: {
      type: "function_call_output",
      call_id: args.callId,
      output: args.output,
    },
  });
}

function completedCommand(args: {
  aggregatedOutput: string;
  callId: string;
  providerThreadId: string;
  turnId: string;
}) {
  return codexEvent("item/completed", {
    threadId: args.providerThreadId,
    turnId: args.turnId,
    completedAtMs: 0,
    item: {
      type: "commandExecution",
      id: args.callId,
      command: "echo hi",
      cwd: "/tmp",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [],
      aggregatedOutput: args.aggregatedOutput,
      exitCode: 0,
      durationMs: 150,
    },
  });
}

/**
 * Runs one raw-shell call to completion and returns the output bb ends up
 * publishing on the commandExecution item.
 */
function publishedCommandOutput(args: {
  providerAggregatedOutput: string;
  rawOutput: string;
  toolName?: string;
}): string | undefined {
  const harness = createHarness();
  const call = {
    callId: "cmd-1",
    providerThreadId: "t1",
    turnId: "turn-1",
    toolName: args.toolName,
  };
  harness.translate(rawShellCall(call));
  harness.translate(rawShellOutput({ ...call, output: args.rawOutput }));
  const events = harness.translate(
    completedCommand({
      ...call,
      aggregatedOutput: args.providerAggregatedOutput,
    }),
  );
  const completed = events.find(
    (event) =>
      event.type === "item/completed" &&
      event.item.type === "commandExecution" &&
      event.item.id === harness.itemId("cmd-1"),
  );
  if (completed?.type !== "item/completed") {
    throw new Error("Expected a completed commandExecution event");
  }
  if (completed.item.type !== "commandExecution") {
    throw new Error("Expected a commandExecution item");
  }
  return completed.item.aggregatedOutput;
}

const METADATA_WRAPPER_LINES = [
  "Chunk ID: abc123",
  "Wall time: 3.6 seconds",
  "Process exited with code 0",
  "Original token count: 8",
];

describe("codex raw shell command-output recovery", () => {
  // Codex truncates the aggregated output it puts on the completed item; the
  // full text arrives separately on the raw shell record, wrapped in UI
  // metadata. The completion must publish the recovered text, not the
  // truncation the user would otherwise be stuck with.
  it("repairs a completed command from a raw result that arrived first", () => {
    expect(
      publishedCommandOutput({
        providerAggregatedOutput: "OUT-2\nOUT-3\n",
        rawOutput: [
          ...METADATA_WRAPPER_LINES,
          "Output:",
          "OUT-1",
          "OUT-2",
          "OUT-3",
          "",
        ].join("\n"),
      }),
    ).toBe("OUT-1\nOUT-2\nOUT-3\n");
  });

  // Only the *first* Output: marker frames the body. Splitting on every
  // occurrence truncated any command that printed the literal string.
  it("preserves a literal Output: line inside the recovered body", () => {
    expect(
      publishedCommandOutput({
        providerAggregatedOutput: "Output:\nsuffix\n",
        rawOutput: [
          ...METADATA_WRAPPER_LINES,
          "Output:",
          "prefix",
          "Output:",
          "suffix",
          "",
        ].join("\n"),
      }),
    ).toBe("prefix\nOutput:\nsuffix\n");
  });

  // A command whose own stdout begins with something that looks like wrapper
  // metadata is not wrapped: with no marker anywhere the whole text is the
  // body, and stripping the first line would eat real output.
  it("preserves a body whose first line looks like wrapper metadata", () => {
    expect(
      publishedCommandOutput({
        providerAggregatedOutput: "actual stdout\n",
        rawOutput: ["Chunk ID: abc", "actual stdout", ""].join("\n"),
      }),
    ).toBe("Chunk ID: abc\nactual stdout\n");
  });

  // Metadata with no marker at all is a framing shape we do not understand.
  // Guessing a body out of it would publish wrapper text as command output, so
  // recovery declines and the provider's own value stands.
  it("ignores a metadata wrapper with no Output marker", () => {
    expect(
      publishedCommandOutput({
        providerAggregatedOutput: "provider output\n",
        rawOutput: METADATA_WRAPPER_LINES.join("\n"),
      }),
    ).toBe("provider output\n");
  });

  // Recovery is gated on the raw call being a shell tool, so every alias codex
  // uses for it has to be recognized or those commands keep the truncation.
  it.each(["Bash", "bash"])(
    "repairs raw shell output for the %s alias",
    (toolName) => {
      expect(
        publishedCommandOutput({
          providerAggregatedOutput: "",
          rawOutput: "Output:\nOUT-1\n",
          toolName,
        }),
      ).toBe("OUT-1\n");
    },
  );

  // Capture is keyed by call id: parallel commands in one turn must not hand
  // each other's stdout to the wrong item.
  it("repairs concurrent command executions independently", () => {
    const harness = createHarness();
    const commands = [
      { callId: "cmd-a", output: "A-1\nA-2\nA-3\n", truncated: "A-2\nA-3\n" },
      { callId: "cmd-b", output: "B-1\nB-2\nB-3\n", truncated: "B-2\nB-3\n" },
    ];

    for (const command of commands) {
      harness.translate(
        rawShellCall({
          callId: command.callId,
          providerThreadId: "t1",
          turnId: "turn-1",
        }),
      );
    }
    for (const command of commands) {
      harness.translate(
        rawShellOutput({
          callId: command.callId,
          output: `Output:\n${command.output}`,
          providerThreadId: "t1",
          turnId: "turn-1",
        }),
      );
    }

    for (const command of commands) {
      expect(
        harness.translate(
          completedCommand({
            aggregatedOutput: command.truncated,
            callId: command.callId,
            providerThreadId: "t1",
            turnId: "turn-1",
          }),
        ),
      ).toContainEqual(
        expect.objectContaining({
          type: "item/completed",
          scope: turnScope(harness.turnId("turn-1")),
          item: expect.objectContaining({
            type: "commandExecution",
            id: harness.itemId(command.callId),
            aggregatedOutput: command.output,
          }),
        }),
      );
    }
  });

  // Captured output is per provider thread. A turn finishing on one thread
  // releases only that thread's pending state; a global flush dropped the
  // recovery for every other live session.
  it("keeps a thread's captured output when a different thread completes a turn", () => {
    const harness = createHarness();
    for (const suffix of ["a", "b"]) {
      harness.translate(
        rawShellCall({
          callId: `cmd-${suffix}`,
          providerThreadId: `thread-${suffix}`,
          turnId: `turn-${suffix}`,
        }),
      );
      harness.translate(
        rawShellOutput({
          callId: `cmd-${suffix}`,
          output: `Output:\n${suffix.toUpperCase()}-1\n${suffix.toUpperCase()}-2\n`,
          providerThreadId: `thread-${suffix}`,
          turnId: `turn-${suffix}`,
        }),
      );
    }

    harness.translate(
      codexEvent("turn/completed", {
        threadId: "thread-a",
        turn: codexTurn({ id: "turn-a", status: "completed", error: null }),
      }),
    );

    expect(
      harness.translate(
        completedCommand({
          aggregatedOutput: "B-2\n",
          callId: "cmd-b",
          providerThreadId: "thread-b",
          turnId: "turn-b",
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope(harness.turnId("turn-b")),
        item: expect.objectContaining({
          type: "commandExecution",
          id: harness.itemId("cmd-b"),
          aggregatedOutput: "B-1\nB-2\n",
        }),
      }),
    );
  });

  // A closed thread's call ids are gone; anything arriving afterwards belongs
  // to no live command. Keeping the state alive let a stale raw record repair
  // (and so overwrite) a later item that reused the id.
  it("drops recovered output state when the thread closes", () => {
    const harness = createHarness();
    harness.translate(
      rawShellCall({
        callId: "cmd-a",
        providerThreadId: "thread-a",
        turnId: "turn-a",
      }),
    );
    harness.translate(codexEvent("thread/closed", { threadId: "thread-a" }));
    harness.translate(
      rawShellOutput({
        callId: "cmd-a",
        output: "Output:\nSTALE\n",
        providerThreadId: "thread-a",
        turnId: "turn-a",
      }),
    );

    expect(
      harness.translate(
        completedCommand({
          aggregatedOutput: "provider output\n",
          callId: "cmd-a",
          providerThreadId: "thread-a",
          turnId: "turn-a",
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope(harness.turnId("turn-a")),
        item: expect.objectContaining({
          type: "commandExecution",
          id: harness.itemId("cmd-a"),
          aggregatedOutput: "provider output\n",
        }),
      }),
    );
  });
});

describe("codex command output capture across reordering", () => {
  const shellCall = {
    callId: "cmd-1",
    providerThreadId: "t1",
    turnId: "turn-1",
  };

  // Codex truncates the aggregated output it puts on the completed item, but
  // the full text arrives separately on the raw shell record — and it can
  // arrive *after* the completion. Emitting the completion immediately
  // published the truncated output permanently, since an item completes once.
  it("defers a completed command until the later raw shell result arrives", () => {
    const harness = createHarness();
    harness.translate(rawShellCall(shellCall));

    expect(
      harness.translate(
        completedCommand({ ...shellCall, aggregatedOutput: "OUT-2\nOUT-3\n" }),
      ),
    ).toEqual([]);

    expect(
      harness.translate(
        rawShellOutput({
          ...shellCall,
          output: "Output:\nOUT-1\nOUT-2\nOUT-3\n",
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope(harness.turnId("turn-1")),
        item: expect.objectContaining({
          type: "commandExecution",
          id: harness.itemId("cmd-1"),
          aggregatedOutput: "OUT-1\nOUT-2\nOUT-3\n",
        }),
      }),
    );
  });

  // The deferral must not be able to swallow a command: if the raw record
  // never lands, the turn boundary releases what the provider did report.
  it("releases a deferred command before turn completion when no raw result arrives", () => {
    const harness = createHarness();
    harness.translate(rawShellCall(shellCall));
    expect(
      harness.translate(
        completedCommand({
          ...shellCall,
          aggregatedOutput: "provider output\n",
        }),
      ),
    ).toEqual([]);

    const completedEvents = harness.translate(
      codexEvent("turn/completed", {
        threadId: "t1",
        turn: codexTurn({ id: "turn-1", status: "completed", error: null }),
      }),
    );

    // Order matters: the item must settle inside the turn it belongs to.
    expect(completedEvents.map((event) => event.type)).toEqual([
      "item/completed",
      "turn/completed",
    ]);
    expect(completedEvents[0]).toMatchObject({
      item: {
        id: harness.itemId("cmd-1"),
        aggregatedOutput: "provider output\n",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Subagent activity correlation to the parent tool call (009dcbd4f, #1361)
// ---------------------------------------------------------------------------

describe("codex subagent activity correlation", () => {
  const rootProviderThreadId = "root-provider-thread";

  function subAgentActivity(args: {
    agentThreadId?: string;
    id: string;
    kind: "started" | "interacted" | "interrupted";
  }) {
    const agentThreadId = args.agentThreadId ?? "agent-thread-1";
    return {
      jsonrpc: "2.0" as const,
      method: "item/completed",
      params: {
        threadId: rootProviderThreadId,
        turnId: "parent-turn",
        item: {
          type: "subAgentActivity",
          id: args.id,
          kind: args.kind,
          agentThreadId,
          agentPath: "/root/lifecycle_child",
        },
      },
    };
  }

  function childTurnStarted(id: string, threadId = rootProviderThreadId) {
    return codexEvent("turn/started", {
      threadId,
      turn: codexTurn({ id, status: "inProgress", error: null }),
    });
  }

  function childTurnCompleted(id: string, threadId = rootProviderThreadId) {
    return codexEvent("turn/completed", {
      threadId,
      turn: codexTurn({ id, status: "completed", error: null }),
    });
  }

  // Codex reports native subagents as tool calls rather than as bb background
  // tasks, so the shared background-work state cannot see them. Releasing an
  // idle session while a child agent is still running kills the child.
  it("reports an unfinished subagent as open thread work", () => {
    const harness = createHarness();
    const work = { providerThreadId: rootProviderThreadId };

    expect(harness.translator.hasOpenThreadWork(work)).toBe(false);

    harness.translate(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );

    expect(harness.translator.hasOpenThreadWork(work)).toBe(true);
    // Scoped per parent thread: another session must not be pinned open.
    expect(
      harness.translator.hasOpenThreadWork({
        providerThreadId: "other-thread",
      }),
    ).toBe(false);

    harness.translate(childTurnStarted("child-turn-1"));
    harness.translate(childTurnCompleted("child-turn-1"));

    expect(harness.translator.hasOpenThreadWork(work)).toBe(false);
  });

  // subAgentActivity is bookkeeping, not a timeline item: bb synthesizes the
  // delegation tool call from it so the child's work renders nested and closes
  // when the child's turn ends. Without the synthesized open/close pair the
  // child's messages had no parent to hang under.
  it("materializes subagent activity as a nested delegation lifecycle", () => {
    const harness = createHarness();

    expect(
      harness.translate(
        subAgentActivity({ id: "subagent-call-1", kind: "started" }),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "item/started",
        scope: turnScope(harness.turnId("parent-turn")),
        item: expect.objectContaining({
          type: "toolCall",
          id: harness.itemId("subagent-call-1"),
          tool: "spawnAgent",
          status: "pending",
          arguments: {
            senderThreadId: rootProviderThreadId,
            receiverThreadIds: ["agent-thread-1"],
            description: "/root/lifecycle_child",
          },
        }),
      }),
    ]);

    expect(harness.translate(childTurnStarted("child-turn-1"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("child-turn-1")),
        parentToolCallId: harness.itemId("subagent-call-1"),
      }),
    );

    expect(
      harness.translate(
        subAgentActivity({ id: "interaction-1", kind: "interacted" }),
      ),
    ).toEqual([]);

    expect(
      harness.translate(
        codexEvent("item/completed", {
          threadId: rootProviderThreadId,
          turnId: "child-turn-1",
          completedAtMs: 0,
          item: {
            type: "agentMessage",
            id: "child-message-1",
            text: "Audit complete.",
            phase: null,
            memoryCitation: null,
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          id: harness.itemId("child-message-1"),
          parentToolCallId: harness.itemId("subagent-call-1"),
        }),
      }),
    );

    expect(harness.translate(childTurnCompleted("child-turn-1"))).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(harness.turnId("child-turn-1")),
      }),
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope(harness.turnId("parent-turn")),
        item: expect.objectContaining({
          type: "toolCall",
          id: harness.itemId("subagent-call-1"),
          tool: "spawnAgent",
          status: "completed",
        }),
      }),
    ]);
  });

  // A subagent that finished and is then interacted with again runs its new
  // turns on the same provider thread. Without re-arming the association on
  // `interacted`, those turns detached from the spawning tool call and the
  // resumed work rendered as top-level activity in the parent thread.
  it("re-arms the parent link when a completed subagent is interacted with again", () => {
    const harness = createHarness();
    harness.translate(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );

    expect(harness.translate(childTurnStarted("child-turn-1"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("child-turn-1")),
        parentToolCallId: harness.itemId("subagent-call-1"),
      }),
    );
    harness.translate(childTurnCompleted("child-turn-1"));

    // The interaction itself is bookkeeping, not a timeline item.
    expect(
      harness.translate(
        subAgentActivity({ id: "interaction-1", kind: "interacted" }),
      ),
    ).toEqual([]);

    expect(harness.translate(childTurnStarted("child-turn-2"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("child-turn-2")),
        parentToolCallId: harness.itemId("subagent-call-1"),
      }),
    );

    // Re-arming must not re-complete the spawning tool call: the delegation
    // item stays open across the resumed turn.
    const resumedTurnCompleted = harness.translate(
      childTurnCompleted("child-turn-2"),
    );
    expect(resumedTurnCompleted).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(harness.turnId("child-turn-2")),
      }),
    ]);
  });

  // Follow-ups queue: two interactions owe two more child turns. The re-arm is
  // counted, so terminalizing the agent after the first follow-up must not
  // discard the link the second one still needs.
  it("preserves the parent link across queued follow-up resumes", () => {
    const harness = createHarness();
    harness.translate(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );
    harness.translate(childTurnStarted("child-turn-1"));
    harness.translate(childTurnCompleted("child-turn-1"));

    for (const index of [1, 2]) {
      harness.translate(
        subAgentActivity({ id: `interaction-${index}`, kind: "interacted" }),
      );
    }

    for (const index of [2, 3]) {
      expect(
        harness.translate(childTurnStarted(`child-turn-${index}`)),
      ).toContainEqual(
        expect.objectContaining({
          type: "turn/started",
          scope: turnScope(harness.turnId(`child-turn-${index}`)),
          parentToolCallId: harness.itemId("subagent-call-1"),
        }),
      );
      expect(
        harness.translate(childTurnCompleted(`child-turn-${index}`)),
      ).toEqual([
        expect.objectContaining({
          type: "turn/completed",
          scope: turnScope(harness.turnId(`child-turn-${index}`)),
        }),
      ]);
    }
  });

  // The re-armed link is owed to the *child's* next turn, not to whatever turn
  // opens next on the multiplexed root thread. A human follow-up sent while a
  // resume is pending must stay a root turn, and must not consume the child's
  // slot either.
  it("does not attach a resumed subagent parent to a later human turn", () => {
    const harness = createHarness();
    harness.translate(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );
    harness.translate(childTurnStarted("child-turn-1"));
    harness.translate(childTurnCompleted("child-turn-1"));
    harness.translate(
      subAgentActivity({ id: "interaction-1", kind: "interacted" }),
    );

    // A queued turn/start is what distinguishes a human turn from a child one.
    expect(
      harness.translator.prepareTurnStart({
        clientRequestId: "creq_followup",
        providerThreadId: rootProviderThreadId,
      }),
    ).not.toBeNull();

    const humanTurnStarted = harness
      .translate(childTurnStarted("human-turn"))
      .find((event) => event.type === "turn/started");
    expect(humanTurnStarted).toEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("human-turn")),
      }),
    );
    expect(humanTurnStarted).not.toHaveProperty("parentToolCallId");

    expect(harness.translate(childTurnStarted("child-turn-2"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("child-turn-2")),
        parentToolCallId: harness.itemId("subagent-call-1"),
      }),
    );
  });

  // Codex can redeliver the same activity item. Counting it twice queued a
  // follow-up nobody owed, so the user's next turn was adopted by the finished
  // subagent.
  it("ignores a duplicated interacted item", () => {
    const harness = createHarness();
    harness.translate(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );
    harness.translate(childTurnStarted("child-turn-1"));
    harness.translate(childTurnCompleted("child-turn-1"));

    harness.translate(
      subAgentActivity({ id: "interaction-1", kind: "interacted" }),
    );
    harness.translate(
      subAgentActivity({ id: "interaction-1", kind: "interacted" }),
    );

    expect(harness.translate(childTurnStarted("child-turn-2"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("child-turn-2")),
        parentToolCallId: harness.itemId("subagent-call-1"),
      }),
    );
    harness.translate(childTurnCompleted("child-turn-2"));

    expect(
      harness.translator.prepareTurnStart({
        clientRequestId: "creq_after_duplicate",
        providerThreadId: rootProviderThreadId,
      }),
    ).not.toBeNull();
    const laterHumanTurn = harness
      .translate(childTurnStarted("human-turn"))
      .find((event) => event.type === "turn/started");
    expect(laterHumanTurn).not.toHaveProperty("parentToolCallId");
  });

  // Two resumed agents each owe a turn. When one of them announces itself on
  // its own agent thread id, that explicit match must win and must not also
  // consume the other agent's FIFO slot on the multiplexed root thread.
  it("does not FIFO-cross-link concurrently resumed subagents", () => {
    const harness = createHarness();
    for (const index of [1, 2]) {
      harness.translate(
        subAgentActivity({
          agentThreadId: `agent-thread-${index}`,
          id: `subagent-call-${index}`,
          kind: "started",
        }),
      );
      harness.translate(childTurnStarted(`child-turn-${index}`));
      harness.translate(childTurnCompleted(`child-turn-${index}`));
    }
    for (const index of [1, 2]) {
      harness.translate(
        subAgentActivity({
          agentThreadId: `agent-thread-${index}`,
          id: `interaction-${index}`,
          kind: "interacted",
        }),
      );
    }

    expect(
      harness.translate(childTurnStarted("resumed-turn-2", "agent-thread-2")),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("resumed-turn-2")),
        parentToolCallId: harness.itemId("subagent-call-2"),
      }),
    );

    expect(
      harness.translate(childTurnStarted("resumed-turn-1")),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("resumed-turn-1")),
        parentToolCallId: harness.itemId("subagent-call-1"),
      }),
    );
  });

  // Concurrent children are multiplexed onto the root thread with no
  // distinguishing id on turn/started, so the only correlation available is
  // activity order. Getting it wrong swaps two live agents' timelines.
  it("links concurrent subagents to child turns in activity order", () => {
    const harness = createHarness();
    for (const index of [1, 2]) {
      harness.translate(
        subAgentActivity({
          agentThreadId: `agent-thread-${index}`,
          id: `subagent-call-${index}`,
          kind: "started",
        }),
      );
    }

    for (const index of [1, 2]) {
      expect(
        harness.translate(childTurnStarted(`child-turn-${index}`)),
      ).toContainEqual(
        expect.objectContaining({
          type: "turn/started",
          scope: turnScope(harness.turnId(`child-turn-${index}`)),
          parentToolCallId: harness.itemId(`subagent-call-${index}`),
        }),
      );
    }
  });

  // An interrupted agent never emits a finishing turn, so the synthesized tool
  // call has to be closed from the interruption or it renders as running
  // forever (and pins the session open).
  it("terminalizes an open subagent when activity is interrupted", () => {
    const harness = createHarness();
    harness.translate(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );

    expect(
      harness.translate(
        subAgentActivity({ id: "interrupt-activity-1", kind: "interrupted" }),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope(harness.turnId("parent-turn")),
        item: expect.objectContaining({
          id: harness.itemId("subagent-call-1"),
          status: "interrupted",
        }),
      }),
    ]);

    // A redelivered start for a call id bb already tracks must not reopen it.
    expect(
      harness.translate(
        subAgentActivity({ id: "subagent-call-1", kind: "started" }),
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Accepted-turn correlation via turn/started (68d80092f, current semantics)
// ---------------------------------------------------------------------------

describe("codex accepted-input correlation", () => {
  // Codex has no per-turn request id: the ack has to be correlated to the
  // provider's next turn/started on that thread. `prepareTurnStart` queues the
  // client request id before dispatch precisely because codex emits
  // turn/started before the turn/start response settles.
  //
  // (The steer ack is NOT translator-owned — the bridge emits it as an
  // `input.accepted` delta against the steered turn — so only the queued-turn
  // half lives here.)
  it("acks a queued turn on turn/started and suppresses the later echo", () => {
    const harness = createHarness();
    expect(
      harness.translator.prepareTurnStart({
        clientRequestId: "creq_23456789ag",
        providerThreadId: "provider-thread-1",
      }),
    ).not.toBeNull();

    const events = harness.translate(
      codexEvent("turn/started", {
        threadId: "provider-thread-1",
        turn: codexTurn({ id: "turn-1", status: "inProgress", error: null }),
      }),
    );
    expect(events).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(harness.turnId("turn-1")),
      },
      {
        type: "turn/input/accepted",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(harness.turnId("turn-1")),
        clientRequestId: "creq_23456789ag",
      },
    ]);

    // bb already owns the user message it sent; the provider's echo of it
    // would render a duplicate.
    expect(
      harness.translate(
        codexEvent("item/completed", {
          threadId: "provider-thread-1",
          turnId: "turn-1",
          completedAtMs: 0,
          item: {
            type: "userMessage",
            id: "provider-user-1",
            clientId: null,
            content: [{ type: "text", text: "normal turn", text_elements: [] }],
          },
        }),
      ),
    ).toMatchObject([]);
  });

  // A dispatch that never reached the provider must not leave a queued id that
  // the *next* turn — possibly a different one — would claim.
  it("drops the queued ack when the dispatch is rolled back", () => {
    const harness = createHarness();
    const prepared = harness.translator.prepareTurnStart({
      clientRequestId: "creq_23456789ag",
      providerThreadId: "provider-thread-1",
    });
    if (!prepared) {
      throw new Error("Expected prepared turn/start state");
    }
    prepared.rollback();

    expect(
      harness.translate(
        codexEvent("turn/started", {
          threadId: "provider-thread-1",
          turn: codexTurn({ id: "turn-1", status: "inProgress", error: null }),
        }),
      ),
    ).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope(harness.turnId("turn-1")),
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Delegation-turn nesting (2da7eb652, #315)
// ---------------------------------------------------------------------------

describe("codex delegation-turn nesting", () => {
  // Same-provider delegation runs the child's turns on the parent's own
  // provider thread. The link is per-turn: it must cover the delegated turn
  // and everything inside it, and must not leak onto the user's next turn on
  // that same thread — which is what made an ordinary follow-up render nested
  // under a finished spawnAgent call.
  it("does not inherit a delegation link onto a later human turn", () => {
    const harness = createHarness();
    const providerThreadId = "root-provider-thread";
    const parentCallId = "call_MV1jTrxEd9bsYdEXQo1PhVOs";

    harness.translate(
      codexEvent("turn/started", {
        threadId: providerThreadId,
        turn: codexTurn({
          id: "parent-turn",
          status: "inProgress",
          error: null,
        }),
      }),
    );
    harness.translate(
      codexEvent("item/started", {
        threadId: providerThreadId,
        turnId: "parent-turn",
        startedAtMs: 0,
        item: {
          type: "collabAgentToolCall",
          id: parentCallId,
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: providerThreadId,
          receiverThreadIds: [],
          prompt: "Run the child command",
          model: null,
          reasoningEffort: null,
          agentsStates: {},
        },
      }),
    );
    harness.translate(
      codexEvent("item/completed", {
        threadId: providerThreadId,
        turnId: "parent-turn",
        completedAtMs: 0,
        item: {
          type: "collabAgentToolCall",
          id: parentCallId,
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: providerThreadId,
          receiverThreadIds: ["child-provider-thread"],
          prompt: "Run the child command",
          model: "gpt-5.5",
          reasoningEffort: "medium",
          agentsStates: {
            "child-provider-thread": { status: "pendingInit", message: null },
          },
        },
      }),
    );
    harness.translate(
      codexEvent("turn/completed", {
        threadId: providerThreadId,
        turn: codexTurn({
          id: "parent-turn",
          status: "completed",
          error: null,
        }),
      }),
    );
    const parentToolCallId = harness.itemId(parentCallId);

    expect(
      harness.translate(
        codexEvent("turn/started", {
          threadId: providerThreadId,
          turn: codexTurn({
            id: "child-turn",
            status: "inProgress",
            error: null,
          }),
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        parentToolCallId,
        scope: turnScope(harness.turnId("child-turn")),
      }),
    );

    expect(
      harness.translate(
        codexEvent("item/started", {
          threadId: providerThreadId,
          turnId: "child-turn",
          startedAtMs: 0,
          item: {
            type: "commandExecution",
            id: "child-command",
            command: "/bin/zsh -lc 'sleep 20; echo CHILD_REAL_PROVIDER_DONE'",
            cwd: "/tmp",
            processId: null,
            source: "agent",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: harness.itemId("child-command"),
          parentToolCallId,
        }),
      }),
    );

    harness.translator.prepareTurnStart({
      clientRequestId: "creq_followup",
      providerThreadId,
    });

    const followUpTurnStarted = harness
      .translate(
        codexEvent("turn/started", {
          threadId: providerThreadId,
          turn: codexTurn({
            id: "follow-up-turn",
            status: "inProgress",
            error: null,
          }),
        }),
      )
      .find((event) => event.type === "turn/started");
    expect(followUpTurnStarted).toEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope(harness.turnId("follow-up-turn")),
      }),
    );
    expect(followUpTurnStarted).not.toHaveProperty("parentToolCallId");

    const followUpAssistant = harness
      .translate(
        codexEvent("item/completed", {
          threadId: providerThreadId,
          turnId: "follow-up-turn",
          completedAtMs: 0,
          item: {
            type: "agentMessage",
            id: "follow-up-assistant",
            text: "follow-up done",
            phase: null,
            memoryCitation: null,
          },
        }),
      )
      .find(
        (event) =>
          event.type === "item/completed" && event.item.type === "agentMessage",
      );
    expect(followUpAssistant).toEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: harness.itemId("follow-up-assistant"),
        }),
      }),
    );
    expect(followUpAssistant).not.toHaveProperty("item.parentToolCallId");

    // The delegated turn keeps its link even though a newer turn has opened.
    expect(
      harness.translate(
        codexEvent("item/commandExecution/outputDelta", {
          threadId: providerThreadId,
          turnId: "child-turn",
          itemId: "child-command",
          delta: "CHILD_REAL_PROVIDER_DONE\n",
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        parentToolCallId,
        scope: turnScope(harness.turnId("child-turn")),
      }),
    );
  });

  // A delegation whose receivers are not known yet still owes its child turn a
  // parent: the call is queued against the parent turn, and the next turn on
  // the same provider thread claims it. Both delegation tools behave the same
  // way, so both have to be recognized as delegations.
  it.each(["spawnAgent", "resumeAgent"] as const)(
    "stamps pending same-provider child turn events for %s",
    (tool) => {
      const harness = createHarness();
      const providerThreadId = "root-provider-thread";

      harness.translate(
        codexEvent("turn/started", {
          threadId: providerThreadId,
          turn: codexTurn({
            id: "parent-turn",
            status: "inProgress",
            error: null,
          }),
        }),
      );
      harness.translate(
        codexEvent("item/started", {
          threadId: providerThreadId,
          turnId: "parent-turn",
          startedAtMs: 0,
          item: {
            type: "collabAgentToolCall",
            id: "delegation-1",
            tool,
            status: "inProgress",
            senderThreadId: providerThreadId,
            receiverThreadIds: [],
            prompt: "Inspect the repo",
            model: null,
            reasoningEffort: null,
            agentsStates: {},
          },
        }),
      );

      expect(
        harness.translate(
          codexEvent("turn/started", {
            threadId: providerThreadId,
            turn: codexTurn({
              id: "child-turn",
              status: "inProgress",
              error: null,
            }),
          }),
        ),
      ).toContainEqual(
        expect.objectContaining({
          type: "turn/started",
          parentToolCallId: harness.itemId("delegation-1"),
          scope: turnScope(harness.turnId("child-turn")),
        }),
      );

      expect(
        harness.translate(
          codexEvent("item/completed", {
            threadId: providerThreadId,
            turnId: "child-turn",
            completedAtMs: 0,
            item: {
              type: "agentMessage",
              id: "child-assistant-1",
              text: "Child done.",
              phase: null,
              memoryCitation: null,
            },
          }),
        ),
      ).toContainEqual(
        expect.objectContaining({
          type: "item/completed",
          item: expect.objectContaining({
            type: "agentMessage",
            id: harness.itemId("child-assistant-1"),
            parentToolCallId: harness.itemId("delegation-1"),
          }),
        }),
      );
    },
  );

  // When the delegation does name its receivers, the child runs on its own
  // provider thread. That explicit mapping — not the FIFO fallback — is what
  // nests the child's events, and it must hold for events the child emits
  // after the call already completed.
  it.each(["spawnAgent", "resumeAgent"] as const)(
    "stamps explicit receiver-thread child events under the %s call",
    (tool) => {
      const harness = createHarness();

      harness.translate(
        codexEvent("item/completed", {
          threadId: "root-provider-thread",
          turnId: "parent-turn",
          completedAtMs: 0,
          item: {
            type: "collabAgentToolCall",
            id: "delegation-1",
            tool,
            status: "completed",
            senderThreadId: "root-provider-thread",
            receiverThreadIds: ["child-provider-thread"],
            prompt: "Inspect the docs",
            model: null,
            reasoningEffort: null,
            agentsStates: {
              "child-provider-thread": { status: "completed", message: "done" },
            },
          },
        }),
      );

      expect(
        harness.translate(
          codexEvent("turn/started", {
            threadId: "child-provider-thread",
            turn: codexTurn({
              id: "child-turn",
              status: "inProgress",
              error: null,
            }),
          }),
        ),
      ).toContainEqual(
        expect.objectContaining({
          type: "turn/started",
          parentToolCallId: harness.itemId("delegation-1"),
          scope: turnScope(harness.turnId("child-turn")),
        }),
      );

      expect(
        harness.translate(
          codexEvent("item/completed", {
            threadId: "child-provider-thread",
            turnId: "child-turn",
            completedAtMs: 0,
            item: {
              type: "agentMessage",
              id: "child-assistant-1",
              text: "Child done.",
              phase: null,
              memoryCitation: null,
            },
          }),
        ),
      ).toContainEqual(
        expect.objectContaining({
          type: "item/completed",
          item: expect.objectContaining({
            type: "agentMessage",
            id: harness.itemId("child-assistant-1"),
            parentToolCallId: harness.itemId("delegation-1"),
          }),
        }),
      );
    },
  );
});
