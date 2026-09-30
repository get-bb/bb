// @vitest-environment jsdom

import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginComposerApi,
  PluginComposerScope,
} from "@get-bb/plugin-sdk/app";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const app = await loadPluginApp(() => import("./app"));
const { openSendLater, resetSendLaterState } = await import("./app");

const customization = app.composerCustomizations[0]!;
const sendMenuItem = customization.sendMenu![0]!;
const picker = customization.banners![0]!;

const HOUR_MS = 60 * 60 * 1000;

function fakeComposer(fields: Partial<PluginComposerApi>): PluginComposerApi {
  return fields as PluginComposerApi;
}

function openPicker(
  options: { scope?: PluginComposerScope; text?: string } = {},
) {
  const scope: PluginComposerScope = options.scope ?? {
    kind: "thread",
    threadId: "thr_scope",
  };
  const text = options.text ?? "ship the release notes";
  const slot = renderSlot(picker, {}, { composer: { scope, text } });
  act(() => {
    openSendLater(fakeComposer({ isEmpty: false, key: slot.composer.key }));
  });
  return slot;
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
        sendMenu: [
          { id: "send-later", label: "Send later…", icon: "Calendar" },
        ],
        banners: [{ id: "send-later", chrome: "bare" }],
      },
    ]);
    expect(customization.plusMenu).toBeUndefined();
  });

  it("disables the row while the composer would not submit", () => {
    const disabled = sendMenuItem.disabled as (
      composer: PluginComposerApi,
    ) => boolean;
    expect(disabled(fakeComposer({ isSubmittingBlocked: true }))).toBe(true);
    expect(disabled(fakeComposer({ isSubmittingBlocked: false }))).toBe(false);
  });

  it("refuses to open for an empty draft", () => {
    expect(openSendLater(fakeComposer({ isEmpty: true, key: "k" }))).toBe(
      false,
    );
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
    const opener = renderSlot(
      picker,
      {},
      { composer: { scope: { kind: "thread", threadId: "thr_a" } } },
    );
    const openerKey = opener.composer.key;
    opener.unmount();
    openSendLater(fakeComposer({ isEmpty: false, key: openerKey }));
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
