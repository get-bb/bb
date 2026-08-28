// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { useInlineHeldDispatchEditing } from "./useInlineHeldDispatchEditing";

function hold(overrides: Partial<DispatchHoldResponse> = {}): DispatchHoldResponse {
  return {
    id: "hold_1",
    kind: "turn",
    threadId: "thr_1",
    holder: "user",
    userReleasable: true,
    reason: "Scheduled",
    payload: {
      kind: "inline",
      input: [{ type: "text", text: "ship it", mentions: [] }],
      execution: {
        model: "opus",
        permissionMode: "auto",
        reasoningLevel: "medium",
        serviceTier: "default",
        source: "client/turn/requested",
      },
      editable: true,
    },
    resumeAt: null,
    expectedReleaseAt: null,
    staleAfterMs: null,
    lastReportAt: null,
    createdAt: 1_000,
    releasedAt: null,
    releaseKind: null,
    ...overrides,
  };
}

/**
 * The session's whole job beyond holding a draft is knowing when it is no
 * longer editing anything. A held message can send on its own timer, or be
 * sent or cancelled from another client, at any point while the editor is
 * open — leaving it open would let a save write into something that already
 * ran.
 */
describe("useInlineHeldDispatchEditing", () => {
  it("closes the session when the edited hold leaves the live list", () => {
    const editable = hold();
    const { result, rerender } = renderHook(
      ({ holds }: { holds: readonly DispatchHoldResponse[] }) =>
        useInlineHeldDispatchEditing({ ownerThreadId: "thr_1", holds }),
      { initialProps: { holds: [editable] as readonly DispatchHoldResponse[] } },
    );

    act(() => {
      result.current.beginEditHeldDispatch(editable);
    });
    expect(result.current.inlineEditingHeldDispatch?.holdId).toBe("hold_1");

    rerender({ holds: [] });
    expect(result.current.inlineEditingHeldDispatch).toBeNull();
    expect(result.current.heldDispatchDraftSession).toBeNull();
  });

  it("closes the session when the thread it belongs to changes", () => {
    const editable = hold();
    const { result, rerender } = renderHook(
      ({ ownerThreadId }: { ownerThreadId: string }) =>
        useInlineHeldDispatchEditing({ ownerThreadId, holds: [editable] }),
      { initialProps: { ownerThreadId: "thr_1" } },
    );

    act(() => {
      result.current.beginEditHeldDispatch(editable);
    });
    expect(result.current.inlineEditingHeldDispatch).not.toBeNull();

    rerender({ ownerThreadId: "thr_2" });
    expect(result.current.inlineEditingHeldDispatch).toBeNull();
  });

  it("refuses to open on a hold the server did not mark editable", () => {
    // A retry hold references a turn that already ran, and a core hold's
    // payload is frozen — neither has a message of its own to rewrite.
    const retry = hold({
      id: "hold_retry",
      payload: { kind: "retry", retryOfTurnRequestId: "ctr_1" },
    });
    const frozen = hold({
      id: "hold_frozen",
      payload: {
        kind: "inline",
        input: [{ type: "text", text: "ship it", mentions: [] }],
        execution: {
          model: "opus",
          permissionMode: "auto",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        editable: false,
      },
    });
    const { result } = renderHook(() =>
      useInlineHeldDispatchEditing({
        ownerThreadId: "thr_1",
        holds: [retry, frozen],
      }),
    );

    act(() => {
      result.current.beginEditHeldDispatch(retry);
      result.current.beginEditHeldDispatch(frozen);
    });
    expect(result.current.inlineEditingHeldDispatch).toBeNull();
  });

  it("applies draft writes against the session's own latest state", () => {
    // Plugin composer actions read and write back-to-back inside one event.
    // React batches state, so a session that applied updates to a rendered
    // snapshot would let the second write clobber the first.
    const editable = hold();
    const { result } = renderHook(() =>
      useInlineHeldDispatchEditing({
        ownerThreadId: "thr_1",
        holds: [editable],
      }),
    );

    act(() => {
      result.current.beginEditHeldDispatch(editable);
    });
    act(() => {
      const session = result.current.heldDispatchDraftSession;
      session?.setDraft((draft) => ({ ...draft, text: `${draft.text} now` }));
      session?.setDraft((draft) => ({ ...draft, text: `${draft.text}!` }));
    });

    expect(result.current.inlineEditingHeldDispatch?.draft.text).toBe(
      "ship it now!",
    );
  });
});
