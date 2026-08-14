// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { TriageEditor } from "./TriageEditor.js";
import type { TriageDraft } from "./validation.js";

class EditorResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", EditorResizeObserver));
afterEach(() => cleanup());

const validDraft: TriageDraft = {
  stableKey: "stable-1",
  status: "EXPLOITABLE",
  justification: null,
  response: null,
  reason: "Reviewed the cached call graph evidence",
  evidence: "Call graph reaches the vulnerable function",
  pin: "exact_version",
};

function editor(
  draft: TriageDraft,
  onCommit: () => void,
  commitBlockedReason: string | null,
): React.JSX.Element {
  return (
    <TriageEditor
      commitBlockedReason={commitBlockedReason}
      draft={draft}
      error={null}
      onCancel={() => {}}
      onChange={() => {}}
      onCommit={onCommit}
      onReasonConfirmed={() => {}}
      onReload={() => {}}
      pending={false}
      prior={null}
      reasonConfirmed
      seededReason={false}
      targetLabel="CVE-2026-194 · gateway 1"
    />
  );
}

describe("TriageEditor commit gates", () => {
  it("binds the resolved-scope disabled predicate and keyboard shortcut to the same reason", () => {
    const onCommit = vi.fn();
    const blockedReason =
      "This draft has no resolved project and version scope. Choose an accepted findings version to continue.";
    const view = render(editor(validDraft, onCommit, null));
    const form = view.getByRole("form", { name: /Triage/u });
    const write = within(form).getByRole("button", { name: /Write YAML/u });
    expect((write as HTMLButtonElement).disabled).toBe(false);

    view.rerender(editor(validDraft, onCommit, blockedReason));
    expect((write as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
    expect(within(form).getByRole("alert").textContent).toBe(blockedReason);

    fireEvent.keyDown(form, { key: "Enter", ctrlKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
  });

  it("surfaces an invalid draft and blocks both click and keyboard commit", () => {
    const onCommit = vi.fn();
    const invalidDraft: TriageDraft = {
      ...validDraft,
      status: "NOT_AFFECTED",
      justification: null,
    };
    const view = render(editor(invalidDraft, onCommit, null));
    const form = view.getByRole("form", { name: /Triage/u });
    const write = within(form).getByRole("button", { name: /Write YAML/u });

    expect((write as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
    expect(within(form).getByRole("alert").textContent).toBe(
      "NOT_AFFECTED requires a justification.",
    );
    fireEvent.keyDown(form, { key: "Enter", metaKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
  });
});
