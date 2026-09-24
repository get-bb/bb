// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerView, PluginComposerScope } from "@get-bb/plugin-sdk/app";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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

async function chooseScheduleOption(
  slot: ReturnType<typeof openPicker>,
  name: string,
): Promise<void> {
  fireEvent.click(slot.getByRole("combobox", { name: "When to send" }));
  fireEvent.click(await slot.findByRole("option", { name }));
}

function dateInputValue(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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
        scopes: ["thread", "new-thread"],
        plusMenu: [
          { id: "send-later", label: "Send later…", icon: "Calendar" },
        ],
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
    openSendLater(
      composerView({ scope: { kind: "thread", threadId: "thr_a" } }),
    );
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

    await slot.behavior.setComposerText("");

    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });
});

describe("scheduling", () => {
  it("previews a preset, then submits only after confirmation", async () => {
    const before = Date.now();
    const slot = openPicker();

    expect(
      slot.getByRole("combobox", { name: "When to send" }).textContent,
    ).toContain("In 1 hour");
    expect(slot.getByText(/^Sends /)).toBeTruthy();
    expect(slot.getByText(/^Local time/)).toBeTruthy();
    expect(slot.inspection.composer.submits).toHaveLength(0);

    fireEvent.click(slot.getByRole("button", { name: "Schedule send" }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    const { sendAt } = slot.inspection.composer.submits[0]!;
    expect(sendAt).toBeGreaterThanOrEqual(before + HOUR_MS);
    expect(sendAt).toBeLessThanOrEqual(Date.now() + HOUR_MS);

    await waitFor(() => expect(slot.inspection.composer.text).toBe(""));
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("schedules a new-thread draft through the same composer pipeline", async () => {
    const before = Date.now();
    const slot = openPicker({
      scope: { kind: "new-thread", projectId: "prj_1" },
    });

    expect(
      slot.getByText(/model and environment selected in the composer/),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Schedule send" }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    expect(slot.inspection.composer.submits[0]!.sendAt).toBeGreaterThanOrEqual(
      before + HOUR_MS,
    );
  });

  it("reveals structured custom fields and schedules their local time", async () => {
    const slot = openPicker();
    const target = new Date(Date.now());
    target.setDate(target.getDate() + 2);
    target.setHours(14, 30, 0, 0);

    await chooseScheduleOption(slot, "Custom date and time");
    fireEvent.change(slot.getByLabelText("Date"), {
      target: { value: dateInputValue(target) },
    });
    fireEvent.change(slot.getByLabelText("Time"), {
      target: { value: "14:30" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Schedule send" }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    expect(slot.inspection.composer.submits[0]!.sendAt).toBe(target.getTime());
  });

  it("blocks a custom time that has already passed", async () => {
    const slot = openPicker();
    const today = new Date();

    await chooseScheduleOption(slot, "Custom date and time");
    fireEvent.change(slot.getByLabelText("Date"), {
      target: { value: dateInputValue(today) },
    });
    fireEvent.change(slot.getByLabelText("Time"), {
      target: { value: "00:00" },
    });

    expect(slot.getByRole("alert").textContent).toContain("future");
    expect(
      slot
        .getByRole("button", { name: "Schedule send" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("ship the release notes");
  });

  it("resolves a relative preset from the confirmation time", async () => {
    const slot = openPicker();
    const now = Date.now();
    const confirmationTime = now + 2 * HOUR_MS;
    vi.spyOn(Date, "now").mockReturnValue(confirmationTime);

    fireEvent.click(slot.getByRole("button", { name: "Schedule send" }));

    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    expect(slot.inspection.composer.submits[0]!.sendAt).toBe(
      confirmationTime + HOUR_MS,
    );
  });

  it("cancels without submitting or clearing the draft", () => {
    const slot = openPicker();

    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));

    expect(slot.queryByRole("dialog")).toBeNull();
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(slot.inspection.composer.text).toBe("ship the release notes");
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
