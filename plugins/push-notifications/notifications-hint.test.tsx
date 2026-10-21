// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pushNotificationsRpcContract,
  type NotificationsHintState,
} from "./contract.js";

const app = await loadPluginApp(() => import("./app.js"));
const hint = app.composerCustomizations[0]!.experimental_hint!;
const ID = "50d1b90b-dc54-4b76-890c-08dcb5e36d4f";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderHint(
  options: {
    permission?: NotificationPermission;
    result?: NotificationPermission;
    enabled?: boolean;
    dismissFails?: boolean;
  } = {},
) {
  const requestPermission = vi.fn(async () => options.result ?? "granted");
  vi.stubGlobal("Notification", {
    permission: options.permission ?? "default",
    requestPermission,
  });
  vi.stubGlobal("isSecureContext", true);
  let state: NotificationsHintState = {
    dismissCount: 0,
    snoozedUntil: null,
    accepted: false,
    suggestion: { id: ID, shown: false },
  };
  let available = true;
  const view = renderSlot(
    hint,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "thr_hint" } },
      settings: { webEnabled: options.enabled ?? true },
      experimental_rpcContract: pushNotificationsRpcContract,
      rpc: {
        "notificationsHint.eligibility": () => ({
          suggestion: available ? { id: ID } : null,
          nextCheckAt: null,
        }),
        "notificationsHint.shown": () => {
          state = { ...state, suggestion: { id: ID, shown: true } };
          return state;
        },
        "notificationsHint.accept": () => {
          available = false;
          state = { ...state, accepted: true };
          return state;
        },
        "notificationsHint.dismiss": () => {
          if (options.dismissFails) throw new Error("offline");
          available = false;
          return {
            ...state,
            dismissCount: 1,
            snoozedUntil: Date.now() + 1_209_600_000,
          };
        },
      },
    },
  );
  return { view, requestPermission };
}

describe("notifications Hint", () => {
  it("records shown only when the Hint enters the visible viewport", async () => {
    let notify = (_entries: { isIntersecting: boolean }[]) => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { view } = renderHint();
    await view.findByRole("button", { name: "Turn on" });
    expect(
      view.inspection.rpcCalls.filter(
        (call) => call.method === "notificationsHint.shown",
      ),
    ).toHaveLength(0);
    await act(async () => notify([{ isIntersecting: false }]));
    expect(
      view.inspection.rpcCalls.filter(
        (call) => call.method === "notificationsHint.shown",
      ),
    ).toHaveLength(0);
    await act(async () => notify([{ isIntersecting: true }]));
    await act(async () => notify([{ isIntersecting: true }]));
    expect(
      view.inspection.rpcCalls.filter(
        (call) => call.method === "notificationsHint.shown",
      ),
    ).toHaveLength(1);
  });

  it.each(["granted", "denied"] as const)(
    "does not offer decided permission: %s",
    async (permission) => {
      const { view, requestPermission } = renderHint({ permission });
      await act(async () => {});
      expect(view.queryByText("Get notified when this needs you")).toBeNull();
      expect(view.inspection.rpcCalls).toEqual([]);
      expect(requestPermission).not.toHaveBeenCalled();
    },
  );

  it("respects a disabled notification channel", async () => {
    const { view, requestPermission } = renderHint({ enabled: false });
    await act(async () => {});
    expect(view.queryByRole("button")).toBeNull();
    expect(view.inspection.rpcCalls).toEqual([]);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission on the primary click and confirms for three seconds", async () => {
    const { view, requestPermission } = renderHint();
    const button = await view.findByRole("button", { name: "Turn on" });
    await waitFor(() =>
      expect(
        view.inspection.rpcCalls.filter(
          (call) => call.method === "notificationsHint.shown",
        ),
      ).toHaveLength(1),
    );
    expect(requestPermission).not.toHaveBeenCalled();
    vi.useFakeTimers();
    await act(async () => fireEvent.click(button));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(view.getByRole("status").textContent).toBe("Notifications on");
    expect(
      view.inspection.rpcCalls.filter(
        (call) => call.method === "notificationsHint.accept",
      ),
    ).toEqual([{ method: "notificationsHint.accept", input: { id: ID } }]);
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(view.getByText("Notifications on")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(view.queryByText("Notifications on")).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
  });

  it("removes a denied request without a success confirmation", async () => {
    const { view, requestPermission } = renderHint({ result: "denied" });
    fireEvent.click(await view.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(view.queryByRole("button")).toBeNull());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(view.queryByText("Notifications on")).toBeNull();
  });

  it("persists Not now before hiding and never asks for permission", async () => {
    const { view, requestPermission } = renderHint();
    fireEvent.click(await view.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(view.queryByRole("button")).toBeNull());
    expect(
      view.inspection.rpcCalls.filter(
        (call) => call.method === "notificationsHint.dismiss",
      ),
    ).toEqual([{ method: "notificationsHint.dismiss", input: { id: ID } }]);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("keeps a failed dismissal actionable", async () => {
    const { view } = renderHint({ dismissFails: true });
    fireEvent.click(await view.findByRole("button", { name: "Not now" }));
    expect(
      await view.findByText("Couldn't save this choice. Try again."),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Not now" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("removes the Hint when permission changes elsewhere", async () => {
    const { view } = renderHint();
    await view.findByRole("button", { name: "Turn on" });
    vi.stubGlobal("Notification", { permission: "denied" });
    fireEvent.focus(window);
    await waitFor(() => expect(view.queryByRole("button")).toBeNull());
  });
});
