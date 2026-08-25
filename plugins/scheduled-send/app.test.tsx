// @vitest-environment jsdom
// Frontend tests: the registration shape the host reads, and the plus-menu →
// banner → rpc → clear flow that is the whole interaction.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerView } from "@get-bb/plugin-sdk/app";

// Load through the thunk so the test runtime is installed before app.tsx binds
// `definePluginApp`; pull the pure helpers from the same evaluation.
const app = await loadPluginApp(() => import("./app"));
const { composerScopeKey, openSendLater, resetSendLaterState } =
  await import("./app");

const customization = app.composerCustomizations[0]!;
const plusMenuItem = customization.plusMenu![0]!;
const banner = customization.banners![0]!;

const HOUR_MS = 60 * 60 * 1000;

function composerView(overrides: {
  threadId?: string;
  text?: string;
  isEmpty?: boolean;
  attachmentCount?: number;
  isSubmitting?: boolean;
}): ComposerView {
  const text = overrides.text ?? "ship the release notes";
  return {
    scope: { kind: "thread", threadId: overrides.threadId ?? "thr_scope" },
    layout: "expanded",
    draft: {
      text,
      isEmpty: overrides.isEmpty ?? text.trim() === "",
      attachmentCount: overrides.attachmentCount ?? 0,
    },
    run: { isRunning: false, isSubmitting: overrides.isSubmitting ?? false },
  };
}

function openBanner(
  options: {
    threadId?: string;
    text?: string;
    attachmentCount?: number;
    rpc?: Record<string, (input: unknown) => unknown>;
  } = {},
) {
  const threadId = options.threadId ?? "thr_scope";
  const text = options.text ?? "ship the release notes";
  openSendLater(composerView({ threadId, text }));
  return renderSlot(
    banner,
    {},
    {
      composer: {
        scope: { kind: "thread", threadId },
        text,
        attachmentCount: options.attachmentCount ?? 0,
      },
      rpc: options.rpc ?? {
        scheduleSend: (input: unknown) => {
          const { holdUntil } = input as { holdUntil: number };
          return { delivery: "held", holdUntil };
        },
      },
    },
  );
}

beforeEach(() => {
  resetSendLaterState();
});

afterEach(() => {
  cleanup();
  resetSendLaterState();
  vi.unstubAllGlobals();
});

describe("registration", () => {
  it("registers one thread-scoped customization with a plus-menu row and banner", () => {
    expect(app.composerCustomizations).toMatchObject([
      {
        id: "send-later",
        // New-thread and side-chat composers are deliberately excluded: this
        // plugin can only schedule a send into an existing thread.
        scopes: ["thread"],
        plusMenu: [
          { id: "send-later", label: "Send later…", icon: "Calendar" },
        ],
        banners: [{ id: "send-later", chrome: "card" }],
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

describe("banner visibility", () => {
  it("renders nothing until the plus-menu row opens it", () => {
    const slot = renderSlot(
      banner,
      {},
      { composer: { scope: { kind: "thread", threadId: "thr_scope" } } },
    );
    expect(slot.container.innerHTML).toBe("");
  });

  it("stays closed in a composer other than the one it was opened from", () => {
    // The store is module-level and every thread composer mounts this banner,
    // so scope identity is what keeps the form in one place.
    openSendLater(composerView({ threadId: "thr_a" }));
    const slot = renderSlot(
      banner,
      {},
      { composer: { scope: { kind: "thread", threadId: "thr_b" } } },
    );
    expect(slot.container.innerHTML).toBe("");
  });

  it("closes when the draft leaves from under it", async () => {
    const slot = openBanner();
    expect(slot.getByText("Send later")).toBeTruthy();

    // The user sent the message the ordinary way while the form was open.
    await slot.behavior.setComposerText("");

    await waitFor(() => expect(slot.container.innerHTML).toBe(""));
  });
});

describe("scheduling", () => {
  it("schedules the draft at a preset and clears the composer", async () => {
    // Presets are computed from the clock the banner captured on mount, so the
    // window this send must fall in opens before the banner does.
    const before = Date.now();
    const slot = openBanner();

    fireEvent.click(slot.getByRole("button", { name: /In 1 hour/ }));

    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    const call = slot.inspection.rpcCalls[0]!;
    expect(call.method).toBe("scheduleSend");
    const input = call.input as {
      threadId: string;
      text: string;
      holdUntil: number;
    };
    expect(input.threadId).toBe("thr_scope");
    expect(input.text).toBe("ship the release notes");
    expect(input.holdUntil).toBeGreaterThanOrEqual(before + HOUR_MS);
    expect(input.holdUntil).toBeLessThanOrEqual(Date.now() + HOUR_MS);

    // The composer surface cannot consume a submission, so the plugin sends
    // the draft itself and clears it; core renders the held card from here.
    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
    await waitFor(() => expect(slot.container.innerHTML).toBe(""));
  });

  it("schedules a freeform duration", async () => {
    const slot = openBanner();
    const before = Date.now();

    fireEvent.change(slot.getByLabelText("Schedule for"), {
      target: { value: "90m" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    const { holdUntil } = slot.inspection.rpcCalls[0]!.input as {
      holdUntil: number;
    };
    expect(holdUntil).toBeGreaterThanOrEqual(before + 90 * 60 * 1000);
  });

  it("reports an unparseable time without calling the backend", async () => {
    const slot = openBanner();

    fireEvent.change(slot.getByLabelText("Schedule for"), {
      target: { value: "next tuesday" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(slot.getByRole("alert")).toBeTruthy());
    expect(slot.inspection.rpcCalls).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("ship the release notes");
  });

  it("keeps the draft when the backend rejects the schedule", async () => {
    const slot = openBanner({
      rpc: {
        scheduleSend: () => {
          throw new Error("That time has already passed.");
        },
      },
    });

    fireEvent.click(slot.getByRole("button", { name: /In 1 hour/ }));

    await waitFor(() =>
      expect(slot.getByRole("alert").textContent).toContain(
        "That time has already passed.",
      ),
    );
    // Losing an unsent draft to a failed schedule would be the worst outcome
    // here, so the clear only happens after the backend confirms.
    expect(slot.inspection.composer.text).toBe("ship the release notes");
    expect(slot.getByText("Send later")).toBeTruthy();
  });

  it("warns that attachments are left behind", () => {
    // The composer surface exposes only an attachment count, never the files,
    // so a scheduled send cannot carry them.
    const slot = openBanner({ attachmentCount: 2 });
    expect(slot.getByText(/Attachments are not included/)).toBeTruthy();
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
