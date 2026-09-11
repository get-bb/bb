// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

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

it("loads push history on demand, recovers from failure, and opens its thread", async () => {
  let fail = true;
  const view = renderSlot(
    app.settingsSections.find((section) => section.id === "history")!,
    {},
    {
      rpc: {
        "notifications.history": () => {
          if (fail) throw new Error("Connection lost");
          return {
            notifications: [
              {
                id: "push-1",
                title: "Release ready",
                body: "Run `deploy --dry-run` to preview.",
                threadId: "thread-1",
                createdAt: 1_789_200_000_000,
                channels: ["mobile"],
              },
            ],
          };
        },
      },
    },
  );
  expect(view.inspection.rpcCalls).toEqual([]);
  fireEvent.click(view.getByRole("button", { name: "Show history" }));
  expect(await view.findByRole("alert")).toHaveProperty(
    "textContent",
    "Connection lost",
  );
  fail = false;
  fireEvent.click(view.getByRole("button", { name: "Refresh" }));
  const thread = await view.findByRole("button", { name: "Release ready" });
  expect(view.getByText("Run `deploy --dry-run` to preview.")).toBeTruthy();
  expect(view.getByText(/Channels attempted: mobile/)).toBeTruthy();
  fireEvent.click(thread);
  expect(view.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thread-1" },
  ]);
  fireEvent.click(view.getByRole("button", { name: "Hide history" }));
  expect(view.queryByRole("button", { name: "Release ready" })).toBeNull();
});
