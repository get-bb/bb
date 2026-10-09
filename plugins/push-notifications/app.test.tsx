// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import type {
  PluginThreadAction,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushNotificationsRpcContract } from "./contract.js";
import type { StoredThreadNotifications } from "./preferences.js";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("device notification settings", () => {
  it("requests permission only on a click and uses the server test route", async () => {
    const requestPermission = vi.fn(async () => "granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("isSecureContext", true);
    const view = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        settings: { webEnabled: true },
        rpc: { "notifications.test": () => ({ ok: true }) },
      },
    );
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(
      await view.findByRole("button", { name: "Allow notifications" }),
    );
    fireEvent.click(
      await view.findByRole("button", { name: "Send test notification" }),
    );
    await waitFor(() =>
      expect(view.inspection.rpcCalls).toEqual([
        { method: "notifications.test", input: { channel: "web" } },
      ]),
    );
  });

  it("explains denied permission without prompting repeatedly", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    vi.stubGlobal("isSecureContext", true);
    const view = renderSlot(
      app.settingsSections[0]!,
      {},
      { settings: { webEnabled: true } },
    );
    expect(await view.findByText(/Notifications are blocked/)).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

const { useBbNavigate, useSdk } = await import("@get-bb/plugin-sdk/app");
const { notificationsThreadAction } = await import("./notificationsAction.js");

function makeTarget(
  overrides: Partial<PluginThreadActionTarget> = {},
): PluginThreadActionTarget {
  return {
    id: "thr_top",
    projectId: "proj_test",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle",
    environment: null,
    ...overrides,
  };
}

type ItemFor = (thread: PluginThreadActionTarget) => PluginThreadAction | null;

function Probe({
  threadIds,
  onItem,
}: {
  threadIds: readonly string[];
  onItem(item: ItemFor): void;
}) {
  const data = notificationsThreadAction.useData!({ threadIds });
  const sdk = useSdk();
  const navigate = useBbNavigate();
  useLayoutEffect(() => {
    onItem((thread) =>
      notificationsThreadAction.item({ thread, data, sdk, navigate }),
    );
  });
  return null;
}

function renderNotifications(
  stored: Record<string, StoredThreadNotifications>,
  threadIds: readonly string[],
) {
  let itemFor: ItemFor | null = null;
  const onItem = (next: ItemFor) => {
    itemFor = next;
  };
  let current = stored;
  const listInput =
    pushNotificationsRpcContract["threadNotifications.list"].input;
  const view = renderSlot(
    { component: Probe },
    { threadIds, onItem },
    {
      settings: { defaultLevel: "all", childLevel: "input-only" },
      rpc: {
        "threadNotifications.list": (input) => ({
          threads: Object.fromEntries(
            listInput
              .parse(input)
              .threadIds.flatMap((id) =>
                current[id] === undefined ? [] : [[id, current[id]]],
              ),
          ),
        }),
        "threadNotifications.set": (input) => ({
          own: pushNotificationsRpcContract[
            "threadNotifications.set"
          ].input.parse(input).level,
          ancestorCap: null,
        }),
      },
    },
  );
  const item = (overrides: Partial<PluginThreadActionTarget> = {}) =>
    itemFor?.(makeTarget(overrides)) ?? null;
  const summary = (overrides: Partial<PluginThreadActionTarget> = {}) => {
    const action = item(overrides);
    return action === null
      ? null
      : {
          detail: action.detail ?? null,
          icon: action.icon,
          inheritLabel:
            action.choices?.items.find((choice) => choice.id === "inherit")
              ?.label ?? null,
          hint: action.choices?.hint ?? null,
          selected:
            action.choices?.items.find((choice) => choice.selected)?.id ?? null,
        };
  };
  return {
    view,
    item,
    summary,
    show(ids: readonly string[]) {
      view.rerender(<Probe threadIds={ids} onItem={onItem} />);
    },
    listCalls: () =>
      view.inspection.rpcCalls
        .filter((call) => call.method === "threadNotifications.list")
        .map((call) => call.input),
    restore(next: Record<string, StoredThreadNotifications>) {
      current = next;
    },
  };
}

describe("thread notifications action", () => {
  it("resolves each shown thread's level and hint", async () => {
    const { summary, listCalls } = renderNotifications(
      {
        thr_top: { own: "muted", ancestorCap: null },
        thr_child: {
          own: "inherit",
          ancestorCap: { level: "muted", threadId: "thr_top" },
        },
        thr_grandchild: {
          own: "inherit",
          ancestorCap: { level: "muted", threadId: "thr_top" },
        },
      },
      ["thr_child", "thr_grandchild", "thr_new", "thr_other", "thr_top"],
    );
    await waitFor(() => expect(summary()?.selected).toBe("muted"));
    expect(summary()).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      inheritLabel: "Default (All activity)",
      hint: null,
      selected: "muted",
    });
    expect(summary({ id: "thr_child", parentThreadId: "thr_top" })).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      inheritLabel: "Default (Needs input only)",
      hint: "Limited by a parent thread",
      selected: "inherit",
    });
    expect(
      summary({ id: "thr_grandchild", parentThreadId: "thr_child" }),
    ).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      inheritLabel: "Default (Needs input only)",
      hint: "Limited by an ancestor thread",
      selected: "inherit",
    });
    expect(summary({ id: "thr_other", parentThreadId: "thr_top" })).toEqual({
      detail: "Needs input only",
      icon: "BellDot",
      inheritLabel: "Default (Needs input only)",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ id: "thr_new" })).toEqual({
      detail: "All activity",
      icon: "push-notifications/ringing",
      inheritLabel: "Default (All activity)",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ id: "thr_unshown" })).toEqual({
      detail: "All activity",
      icon: "push-notifications/ringing",
      inheritLabel: "Default (All activity)",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ archivedAt: 1 })).toBeNull();
    expect(listCalls()).toEqual([
      {
        threadIds: [
          "thr_child",
          "thr_grandchild",
          "thr_new",
          "thr_other",
          "thr_top",
        ],
      },
    ]);
  });

  it("fetches only ids it has not loaded, once each, and none for an empty list", async () => {
    const { show, listCalls } = renderNotifications({}, []);
    await act(async () => {});
    expect(listCalls()).toEqual([]);
    show(["thr_a", "thr_b"]);
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    show(["thr_a", "thr_b", "thr_c"]);
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    show(["thr_a"]);
    show(["thr_a", "thr_b", "thr_c"]);
    await act(async () => {});
    const many = Array.from({ length: 250 }, (_, index) => `thr_${index}`);
    show(many);
    await waitFor(() => expect(listCalls()).toHaveLength(4));
    expect(listCalls()).toEqual([
      { threadIds: ["thr_a", "thr_b"] },
      { threadIds: ["thr_c"] },
      { threadIds: many.slice(0, 200) },
      { threadIds: many.slice(200) },
    ]);
  });

  it("shows an unarchived thread's stored level without a reload", async () => {
    const { show, summary } = renderNotifications(
      { thr_top: { own: "muted", ancestorCap: null } },
      [],
    );
    expect(summary({ archivedAt: 1 })).toBeNull();
    show(["thr_top"]);
    await waitFor(() => expect(summary()?.selected).toBe("muted"));
  });

  it("applies its own write, realtime updates, and a reload after reconnecting", async () => {
    const { view, item, summary, restore, listCalls } = renderNotifications(
      {},
      ["thr_top"],
    );
    await waitFor(() => expect(summary()?.selected).toBe("inherit"));

    await act(() => item()!.run({ value: "muted", requestRename: () => {} }));
    expect(view.inspection.rpcCalls.at(-1)).toEqual({
      method: "threadNotifications.set",
      input: { threadId: "thr_top", level: "muted" },
    });
    expect(summary()?.selected).toBe("muted");

    await view.behavior.emitRealtime("threadNotifications", {
      threadId: "thr_top",
      notifications: null,
    });
    expect(summary()?.selected).toBe("inherit");

    restore({ thr_top: { own: "all", ancestorCap: null } });
    await view.behavior.setRealtimeConnectionState("reconnecting");
    await view.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(summary()?.selected).toBe("all"));
    expect(listCalls()).toHaveLength(2);
  });

  it("refetches threads that were off screen during a reconnect when they return", async () => {
    const { view, show, summary, restore, listCalls } = renderNotifications(
      {
        thr_a: { own: "muted", ancestorCap: null },
        thr_b: { own: "muted", ancestorCap: null },
        thr_c: { own: "muted", ancestorCap: null },
      },
      ["thr_a", "thr_b", "thr_c"],
    );
    await waitFor(() =>
      expect(summary({ id: "thr_c" })?.selected).toBe("muted"),
    );
    show(["thr_a"]);

    restore({
      thr_a: { own: "muted", ancestorCap: null },
      thr_b: { own: "all", ancestorCap: null },
    });
    await view.behavior.setRealtimeConnectionState("reconnecting");
    await view.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(listCalls()).toHaveLength(2));

    show(["thr_a", "thr_b", "thr_c"]);
    await waitFor(() =>
      expect(summary({ id: "thr_b" })?.selected).toBe("all"),
    );
    expect(summary({ id: "thr_c" })?.selected).toBe("inherit");
    expect(summary({ id: "thr_a" })?.selected).toBe("muted");
    expect(listCalls()).toEqual([
      { threadIds: ["thr_a", "thr_b", "thr_c"] },
      { threadIds: ["thr_a"] },
      { threadIds: ["thr_b", "thr_c"] },
    ]);
  });
});
