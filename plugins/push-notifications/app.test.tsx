// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function thread(status: PluginSidebarThread["status"]): PluginSidebarThread {
  return {
    id: "thr_running",
    projectId: "project-one",
    title: "Fix the build",
    titleFallback: null,
    displayTitle: "Fix the build",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status,
    runtimeStatus: status,
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: "/projects/project-one/threads/thr_running",
    isHidden: false,
    environment: null,
    host: { id: "host-1", name: "Laptop" },
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
  };
}

function renderPrompt(
  status: PluginSidebarThread["status"],
  recordTelemetryEvent = vi.fn(async () => ({ ok: true as const })),
) {
  const overlay = app.appOverlays.find((entry) => entry.id === "prompt");
  if (overlay === undefined) throw new Error("missing prompt overlay");
  return renderSlot(
    overlay,
    {},
    {
      pluginId: "push-notifications",
      settings: { webEnabled: true },
      context: { projectId: "project-one", threadId: "thr_running" },
      sidebarThreads: { status: "ready", threads: [thread(status)] },
      sdk: {
        system: { experimental_recordTelemetryEvent: recordTelemetryEvent },
      },
    },
  );
}

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

describe("running thread notification prompt", () => {
  it("asks while the open thread runs and requests permission only on a click", async () => {
    const requestPermission = vi.fn(async () => "granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("isSecureContext", true);
    const recordTelemetryEvent = vi.fn(async () => ({ ok: true as const }));

    const view = renderPrompt("active", recordTelemetryEvent);

    expect(
      await view.findByText("Get notified when this agent needs you?"),
    ).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(recordTelemetryEvent.mock.calls.map(([event]) => event)).toEqual([
        {
          name: "notification_prompt_shown",
          properties: { surface: "thread" },
        },
        {
          name: "notification_prompt_accepted",
          properties: { surface: "thread" },
        },
      ]),
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("stays hidden for idle threads", () => {
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("isSecureContext", true);

    const view = renderPrompt("idle");

    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("does not ask again after Not now", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("isSecureContext", true);

    const first = renderPrompt("active");
    fireEvent.click(await first.findByRole("button", { name: "Not now" }));
    expect(first.queryByRole("dialog")).toBeNull();
    cleanup();

    const second = renderPrompt("active");
    expect(second.queryByRole("dialog")).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("stops asking once permission was decided after the overlay mounted", () => {
    const reads: NotificationPermission[] = ["default"];
    vi.stubGlobal("Notification", {
      get permission() {
        return reads.shift() ?? "granted";
      },
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("isSecureContext", true);
    const recordTelemetryEvent = vi.fn(async () => ({ ok: true as const }));

    const view = renderPrompt("active", recordTelemetryEvent);

    expect(view.queryByRole("dialog")).toBeNull();
    expect(recordTelemetryEvent).not.toHaveBeenCalled();
  });

  it("never asks once the browser already denied permission", () => {
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("isSecureContext", true);

    const view = renderPrompt("active");

    expect(view.queryByRole("dialog")).toBeNull();
  });
});
