// @vitest-environment jsdom
// Frontend tests: the registration shape the host reads, and the plus-menu →
// dialog → composer-submit → clear flow that is the whole interaction.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerView, PluginComposerScope } from "@get-bb/plugin-sdk/app";

// Load through the thunk so the test runtime is installed before app.tsx binds
// `definePluginApp`; pull the pure helpers from the same evaluation.
const app = await loadPluginApp(() => import("./app"));
const { composerScopeKey, openSendLater, resetSendLaterState } =
  await import("./app");

const customization = app.composerCustomizations[0]!;
const plusMenuItem = customization.plusMenu![0]!;
const picker = customization.banners![0]!;

const HOUR_MS = 60 * 60 * 1000;

function composerView(overrides: {
  scope?: PluginComposerScope;
  text?: string;
  isEmpty?: boolean;
  attachmentCount?: number;
  isSubmitting?: boolean;
}): ComposerView {
  const text = overrides.text ?? "ship the release notes";
  return {
    scope: overrides.scope ?? { kind: "thread", threadId: "thr_scope" },
    layout: "expanded",
    draft: {
      text,
      isEmpty: overrides.isEmpty ?? text.trim() === "",
      attachmentCount: overrides.attachmentCount ?? 0,
    },
    run: { isRunning: false, isSubmitting: overrides.isSubmitting ?? false },
  };
}

function openPicker(
  options: { scope?: PluginComposerScope; text?: string } = {},
) {
  const scope: PluginComposerScope = options.scope ?? {
    kind: "thread",
    threadId: "thr_scope",
  };
  const text = options.text ?? "ship the release notes";
  openSendLater(composerView({ scope, text }));
  return renderSlot(picker, {}, { composer: { scope, text } });
}

beforeEach(() => {
  resetSendLaterState();
});

afterEach(() => {
  cleanup();
  resetSendLaterState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("registration", () => {
  it("registers one customization covering both dispatchable composers", () => {
    expect(app.composerCustomizations).toMatchObject([
      {
        id: "send-later",
        // Queued-message editors and side chats are deliberately excluded:
        // neither owns a dispatchable submission of its own.
        scopes: ["thread", "new-thread"],
        plusMenu: [
          { id: "send-later", label: "Send later…", icon: "Calendar" },
        ],
        // The picker is the host's portalled dialog, so the mount point wears
        // no card chrome.
        banners: [{ id: "send-later", chrome: "bare" }],
      },
    ]);
  });

  it("disables the row when there is no draft to schedule", () => {
    const disabled = plusMenuItem.disabled as (view: ComposerView) => boolean;
    expect(disabled(composerView({ text: "" }))).toBe(true);
    expect(disabled(composerView({ isSubmitting: true }))).toBe(true);
    expect(disabled(composerView({}))).toBe(false);
  });
});

describe("picker visibility", () => {
  it("stays closed until the plus-menu row opens it", () => {
    const slot = renderSlot(
      picker,
      {},
      { composer: { scope: { kind: "thread", threadId: "thr_scope" } } },
    );
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("stays closed in a composer other than the one it was opened from", () => {
    // The store is module-level and every composer mounts this slot, so scope
    // identity is what keeps the picker in one place.
    openSendLater(composerView({ scope: { kind: "thread", threadId: "thr_a" } }));
    const slot = renderSlot(
      picker,
      {},
      { composer: { scope: { kind: "thread", threadId: "thr_b" } } },
    );
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("closes when the draft leaves from under it", async () => {
    const slot = openPicker();
    expect(slot.getByRole("dialog")).toBeTruthy();

    // The user sent the message the ordinary way while the picker was open.
    await slot.behavior.setComposerText("");

    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });
});

describe("scheduling", () => {
  it("submits through the composer at a preset and clears the draft", async () => {
    // Presets are computed from the clock the picker captured on mount, so the
    // window this submission must fall in opens before the picker does.
    const before = Date.now();
    const slot = openPicker();

    fireEvent.click(slot.getByRole("button", { name: /In 1 hour/ }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    const { holdUntil } = slot.inspection.composer.submits[0]!;
    expect(holdUntil).toBeGreaterThanOrEqual(before + HOUR_MS);
    expect(holdUntil).toBeLessThanOrEqual(Date.now() + HOUR_MS);

    // The host's own submit pipeline consumed the draft, so nothing is left to
    // schedule and the picker closes.
    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("schedules a new-thread draft the same way", async () => {
    // The whole point of routing through the composer: a new-thread draft is
    // scheduled with the execution selections the host resolves, not with
    // anything this plugin could assemble.
    const before = Date.now();
    const slot = openPicker({
      scope: { kind: "new-thread", projectId: "prj_1" },
    });

    fireEvent.click(slot.getByRole("button", { name: /In 1 hour/ }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    expect(slot.inspection.composer.submits[0]!.holdUntil).toBeGreaterThanOrEqual(
      before + HOUR_MS,
    );
  });

  it("schedules a freeform duration", async () => {
    const slot = openPicker();
    const before = Date.now();

    fireEvent.change(slot.getByLabelText("Schedule for"), {
      target: { value: "90m" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Schedule" }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    expect(slot.inspection.composer.submits[0]!.holdUntil).toBeGreaterThanOrEqual(
      before + 90 * 60 * 1000,
    );
  });

  it("reports an unparseable time without submitting", async () => {
    const slot = openPicker();

    fireEvent.change(slot.getByLabelText("Schedule for"), {
      target: { value: "next tuesday" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(slot.getByRole("alert")).toBeTruthy());
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("ship the release notes");
  });

  it("refuses a preset that went stale while the picker sat open", async () => {
    // The picker's clock only ticks every 30s, and it can sit open for hours.
    // A preset resolved against that stale clock would be a past `holdUntil`,
    // which the server releases on its next sweep — an instant send nobody
    // asked for.
    const slot = openPicker();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2 * HOUR_MS);

    fireEvent.click(slot.getByRole("button", { name: /In 1 hour/ }));

    await waitFor(() =>
      expect(slot.getByRole("alert").textContent).toContain("just passed"),
    );
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("ship the release notes");
    expect(slot.getByRole("dialog")).toBeTruthy();
  });
});

describe("composerScopeKey", () => {
  it("distinguishes every composer kind", () => {
    const keys = [
      composerScopeKey({ kind: "thread", threadId: "t1" }),
      composerScopeKey({
        kind: "queued-message",
        threadId: "t1",
        queuedMessageId: "q1",
      }),
      composerScopeKey({
        kind: "side-chat",
        projectId: "p1",
        parentThreadId: "t1",
        tabId: "tab1",
        childThreadId: null,
      }),
      composerScopeKey({ kind: "new-thread", projectId: null }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
