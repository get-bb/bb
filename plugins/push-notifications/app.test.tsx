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
import type { ThreadNotificationInputs } from "./preferences.js";

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
  stored: Record<string, ThreadNotificationInputs>,
  threadIds: readonly string[],
) {
  let itemFor: ItemFor | null = null;
  const onItem = (next: ItemFor) => {
    itemFor = next;
  };
  let current = stored;
  const listInput =
    pushNotificationsRpcContract["threadNotifications.keyed"].input;
  const view = renderSlot(
    { component: Probe },
    { threadIds, onItem },
    {
      experimental_rpcContract: {
        "threadNotifications.keyed":
          pushNotificationsRpcContract["threadNotifications.keyed"],
        "threadNotifications.set":
          pushNotificationsRpcContract["threadNotifications.set"],
      },
      settings: { defaultLevel: "all", childLevel: "input-only" },
      rpc: {
        "threadNotifications.keyed": async (input) => {
          const threads = Object.fromEntries(
            listInput
              .parse(input)
              .keys.map((id) => [
                id,
                current[id] ?? { own: "inherit", ancestorCap: null },
              ]),
          );
          return threads;
        },
        "threadNotifications.set": (input) => {
          const { threadId, level } =
            pushNotificationsRpcContract["threadNotifications.set"].input.parse(
              input,
            );
          const saved = { own: level, ancestorCap: null };
          current = { ...current, [threadId]: saved };
          return saved;
        },
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
    restore(next: Record<string, ThreadNotificationInputs>) {
      current = next;
    },
  };
}

describe("thread notifications action", () => {
  it("resolves each shown thread's level and hint", async () => {
    const { summary } = renderNotifications(
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
      hint: null,
      selected: "muted",
    });
    expect(summary({ id: "thr_child", parentThreadId: "thr_top" })).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      hint: "Limited by a parent thread",
      selected: "inherit",
    });
    expect(
      summary({ id: "thr_grandchild", parentThreadId: "thr_child" }),
    ).toEqual({
      detail: "Muted",
      icon: "push-notifications/off",
      hint: "Limited by an ancestor thread",
      selected: "inherit",
    });
    expect(summary({ id: "thr_other", parentThreadId: "thr_top" })).toEqual({
      detail: "Needs input only",
      icon: "BellDot",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ id: "thr_new" })).toEqual({
      detail: "All activity",
      icon: "push-notifications/ringing",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ id: "thr_unshown" })).toEqual({
      detail: "All activity",
      icon: "push-notifications/ringing",
      hint: null,
      selected: "inherit",
    });
    expect(summary({ archivedAt: 1 })).toBeNull();
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

  it("refreshes shown levels after its own write and a change from another client", async () => {
    const { view, item, summary, restore } = renderNotifications({}, [
      "thr_top",
    ]);
    await waitFor(() => expect(summary()?.selected).toBe("inherit"));
    await act(() => item()!.run({ value: "muted", requestRename: () => {} }));
    await waitFor(() => expect(summary()?.selected).toBe("muted"));
    restore({ thr_top: { own: "all", ancestorCap: null } });
    await view.behavior.experimental_invalidateRpc(["thread:thr_top"]);
    await waitFor(() => expect(summary()?.selected).toBe("all"));
  });
  it("reflects a parent cap changed by another client", async () => {
    const { view, summary, restore } = renderNotifications({}, [
      "thr_child",
      "thr_top",
    ]);
    await waitFor(() => expect(summary()?.selected).toBe("inherit"));
    const child = { id: "thr_child", parentThreadId: "thr_top" };
    expect(summary(child)?.detail).toBe("Needs input only");

    restore({
      thr_top: { own: "muted", ancestorCap: null },
      thr_child: {
        own: "inherit",
        ancestorCap: { level: "muted", threadId: "thr_top" },
      },
    });
    await view.behavior.experimental_invalidateRpc([
      "thread:thr_top",
      "thread:thr_child",
    ]);
    expect(summary(child)).toMatchObject({
      detail: "Muted",
      hint: "Limited by a parent thread",
    });
    expect(summary()?.selected).toBe("muted");
  });
});
