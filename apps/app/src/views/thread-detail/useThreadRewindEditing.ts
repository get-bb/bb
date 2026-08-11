import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PromptInput,
  PromptTextMention,
  ThreadRewindFailureReason,
} from "@bb/domain";
import type { ThreadRewindPreviewResponse } from "@bb/server-contract";
import { BbHttpError } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import {
  emptyPromptDraftState,
  type PromptDraftState,
} from "@/lib/prompt-draft";
import {
  buildThreadRewindIdempotencyKey,
  threadRewindFailureMessage,
  threadRewindIneligibilityDescription,
} from "@/lib/thread-rewind";

export type ThreadRewindEditingStatus =
  | "checking"
  | "confirming"
  | "draft-recovery"
  | "failed"
  | "stale"
  | "submitting";

export interface ThreadRewindEditingTarget {
  branchId: string;
  sourceSequence: number;
  turnId: string;
}

export interface ThreadRewindEditingSession extends ThreadRewindEditingTarget {
  displacedTurnCount: number;
  idempotencyKey: string;
  /** User-facing copy for stale, failure, and recovery states. */
  message: string | null;
  retryable: boolean;
  revision: number;
  status: ThreadRewindEditingStatus;
  target: ThreadRewindPreviewResponse["target"];
}

export interface ThreadRewindBeginTarget extends ThreadRewindEditingTarget {
  /** Original message text restored into the composer. */
  restoreText: string;
  /** Original message mentions restored into the composer. */
  restoreMentions: readonly PromptTextMention[];
}

export interface UseThreadRewindEditingArgs {
  /** Active branch pointer; rewind is disabled until it resolves. */
  branchId: string | null;
  onFocusComposer: () => void;
  onSettled?: (outcome: {
    displacedTurnCount: number;
    submission: "draft-recovery" | "submitted";
  }) => void;
  readDraft: () => PromptDraftState;
  /** Changes when the thread leaves or returns to idle; triggers revalidation. */
  statusKey: string;
  threadId: string;
  writeDraft: (draft: PromptDraftState) => void;
}

export interface ThreadRewindEditingApi {
  beginRewind: (target: ThreadRewindBeginTarget) => void;
  cancel: () => void;
  commitRewind: (editedInput: PromptInput[]) => void;
  dismiss: () => void;
  revalidate: () => void;
  session: ThreadRewindEditingSession | null;
}

const EMPTY_DRAFT = emptyPromptDraftState();

function isFailureReason(
  code: string | null,
): code is ThreadRewindFailureReason {
  if (code === null) return false;
  return (
    code === "thread-not-found" ||
    code === "thread-not-idle" ||
    code === "pending-interaction" ||
    code === "queued-input" ||
    code === "rewind-in-progress" ||
    code === "target-ineligible" ||
    code === "provider-branch-failed" ||
    code === "provider-session-unavailable" ||
    code === "branch-commit-failed" ||
    code === "workspace-restore-not-supported" ||
    code === "stale-preview"
  );
}

/**
 * Owns one rewind edit session for the main thread composer: restores the
 * original message into the draft, keeps the preview fresh, commits with an
 * idempotency key, and preserves user input at every failure point.
 */
export function useThreadRewindEditing({
  branchId,
  onFocusComposer,
  onSettled,
  readDraft,
  statusKey,
  threadId,
  writeDraft,
}: UseThreadRewindEditingArgs): ThreadRewindEditingApi {
  const [session, setSession] = useState<ThreadRewindEditingSession | null>(
    null,
  );
  const sessionRef = useRef<ThreadRewindEditingSession | null>(null);
  sessionRef.current = session;
  /** Draft present before the first edit of a session sequence; cancel restores it. */
  const previousDraftRef = useRef<PromptDraftState>(EMPTY_DRAFT);

  const isCurrentTarget = useCallback(
    (target: ThreadRewindEditingTarget): boolean => {
      const current = sessionRef.current;
      return (
        current !== null &&
        current.branchId === target.branchId &&
        current.sourceSequence === target.sourceSequence &&
        current.turnId === target.turnId
      );
    },
    [],
  );

  const runPreview = useCallback(
    async (target: ThreadRewindEditingTarget): Promise<void> => {
      if (threadId === "") return;
      let preview: ThreadRewindPreviewResponse;
      try {
        preview = await sdk.threads.rewind.preview({
          branchId: target.branchId,
          sourceSequence: target.sourceSequence,
          threadId,
          turnId: target.turnId,
        });
      } catch {
        if (!isCurrentTarget(target)) return;
        setSession((current) =>
          current === null || !isCurrentTarget(target)
            ? current
            : {
                ...current,
                message: "Could not check eligibility. Check your connection and try again.",
                retryable: true,
                status: "stale",
              },
        );
        return;
      }
      if (!isCurrentTarget(target)) return;
      setSession((current) => {
        if (current === null || !isCurrentTarget(target)) return current;
        if (preview.eligibility.status !== "eligible") {
          return {
            ...current,
            message: threadRewindIneligibilityDescription(
              preview.eligibility.reason,
            ),
            retryable: false,
            status: "stale",
          };
        }
        if (current.revision !== -1 && preview.revision !== current.revision) {
          return {
            ...current,
            message:
              "The conversation changed since this edit opened. Refresh to re-check.",
            retryable: true,
            status: "stale",
          };
        }
        return {
          ...current,
          displacedTurnCount: preview.displacedTurnCount,
          revision: preview.revision,
          status: "confirming",
          target: preview.target,
        };
      });
    },
    [isCurrentTarget, threadId],
  );

  const beginRewind = useCallback(
    (target: ThreadRewindBeginTarget): void => {
      if (
        threadId === "" ||
        branchId === null ||
        sessionRef.current?.status === "submitting"
      ) {
        return;
      }
      if (sessionRef.current === null) {
        previousDraftRef.current = readDraft();
      }
      writeDraft({
        attachments: [],
        mentions: [...target.restoreMentions],
        text: target.restoreText,
      });
      onFocusComposer();
      const idempotencyKey = buildThreadRewindIdempotencyKey({
        branchId: target.branchId,
        sourceSequence: target.sourceSequence,
        threadId,
        turnId: target.turnId,
      });
      const nextSession: ThreadRewindEditingSession = {
        branchId: target.branchId,
        displacedTurnCount: 0,
        idempotencyKey,
        message: null,
        retryable: false,
        revision: -1,
        sourceSequence: target.sourceSequence,
        status: "checking",
        target: {
          branchId: target.branchId,
          sourceSequence: target.sourceSequence,
          turnId: target.turnId,
        },
        turnId: target.turnId,
      };
      setSession(nextSession);
      void runPreview(target);
    },
    [branchId, onFocusComposer, readDraft, runPreview, threadId, writeDraft],
  );

  const revalidate = useCallback((): void => {
    const current = sessionRef.current;
    if (
      current === null ||
      current.status === "submitting" ||
      current.status === "failed" ||
      current.status === "draft-recovery"
    ) {
      return;
    }
    void runPreview({
      branchId: current.branchId,
      sourceSequence: current.sourceSequence,
      turnId: current.turnId,
    });
  }, [runPreview]);

  const commitRewind = useCallback(
    (editedInput: PromptInput[]): void => {
      const current = sessionRef.current;
      if (current === null || current.status === "submitting") return;
      if (current.status !== "confirming" && !current.retryable) return;
      if (editedInput.length === 0) return;
      setSession((existing) =>
        existing === null || !isCurrentTarget(current)
          ? existing
          : { ...existing, message: null, status: "submitting" },
      );
      void (async () => {
        try {
          const response = await sdk.threads.rewind.commit({
            editedInput,
            idempotencyKey: current.idempotencyKey,
            mode: "conversation-only",
            preview: { revision: current.revision, target: current.target },
            target: current.target,
            threadId,
          });
          if (!isCurrentTarget(current)) return;
          if (response.submission === "submitted") {
            writeDraft(EMPTY_DRAFT);
            setSession(null);
            onSettled?.({
              displacedTurnCount: current.displacedTurnCount,
              submission: "submitted",
            });
            return;
          }
          setSession((existing) =>
            existing === null || !isCurrentTarget(current)
              ? existing
              : {
                  ...existing,
                  message:
                    "The rewound branch is active, but the edited turn wasn't sent. Your edit is preserved in the composer — send it again to continue.",
                  retryable: false,
                  status: "draft-recovery",
                },
          );
          onSettled?.({
            displacedTurnCount: current.displacedTurnCount,
            submission: "draft-recovery",
          });
        } catch (error) {
          if (!isCurrentTarget(current)) return;
          let code: string | null = null;
          let serverMessage: string | null = null;
          let retryable = true;
          if (error instanceof BbHttpError) {
            code = error.code;
            const body = error.body as
              | { message?: unknown; retryable?: unknown }
              | null;
            serverMessage =
              typeof body?.message === "string" ? body.message : null;
            retryable = body?.retryable !== false;
          }
          setSession((existing) =>
            existing === null || !isCurrentTarget(current)
              ? existing
              : {
                  ...existing,
                  message: isFailureReason(code)
                    ? threadRewindFailureMessage(code)
                    : (serverMessage ??
                      "The edit could not be sent. Your edit is preserved in the composer."),
                  retryable,
                  status: "failed",
                },
          );
        }
      })();
    },
    [isCurrentTarget, onSettled, threadId, writeDraft],
  );

  const cancel = useCallback((): void => {
    const current = sessionRef.current;
    if (current === null || current.status === "submitting") return;
    writeDraft(previousDraftRef.current);
    setSession(null);
  }, [writeDraft]);

  const dismiss = useCallback((): void => {
    const current = sessionRef.current;
    if (current === null || current.status === "submitting") return;
    // Recovery and failure keep the user's draft in the composer.
    setSession(null);
  }, []);

  // Keep the confirmation honest while the editor is open: a thread that
  // starts running, resolves an interaction, or switches branches changes
  // eligibility and must re-check before commit.
  useEffect(() => {
    const current = sessionRef.current;
    if (
      current === null ||
      current.status === "submitting" ||
      current.status === "failed" ||
      current.status === "draft-recovery"
    ) {
      return;
    }
    if (branchId !== null && branchId !== current.branchId) {
      setSession((existing) =>
        existing === null
          ? existing
          : {
              ...existing,
              message:
                "The thread's active branch changed. Refresh to re-check before continuing.",
              retryable: true,
              status: "stale",
            },
      );
      return;
    }
    void runPreview({
      branchId: current.branchId,
      sourceSequence: current.sourceSequence,
      turnId: current.turnId,
    });
    // Re-run whenever the thread status or active branch changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, statusKey]);

  return {
    beginRewind,
    cancel,
    commitRewind,
    dismiss,
    revalidate,
    session,
  };
}
