// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const hosts = [
  { id: "host-1", name: "Laptop", status: "connected" as const },
  { id: "host-2", name: "Studio", status: "disconnected" as const },
];

function response(configuration: unknown) {
  if (typeof configuration !== "object" || configuration === null) {
    throw new Error("Expected a Keep Awake configuration");
  }
  const enabled = Reflect.get(configuration, "enabled");
  const selection = Reflect.get(configuration, "selection");
  if (
    typeof enabled !== "boolean" ||
    typeof selection !== "object" ||
    selection === null
  ) {
    throw new Error("Expected a Keep Awake configuration");
  }
  const mode = Reflect.get(selection, "mode");
  if (mode === "all") {
    const allSelection: { mode: "all" } = { mode };
    return { enabled, selection: allSelection, hosts };
  }
  const hostIds = Reflect.get(selection, "hostIds");
  if (
    mode !== "selected" ||
    !Array.isArray(hostIds) ||
    !hostIds.every((hostId) => typeof hostId === "string")
  ) {
    throw new Error("Expected a Keep Awake configuration");
  }
  return { enabled, selection: { mode, hostIds }, hosts };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Keep Awake settings", () => {
  it("autosaves the enabled state, scope, and individual hosts in one configuration", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getConfiguration: () =>
            response({ enabled: false, selection: { mode: "all" } }),
          setConfiguration: (configuration) => response(configuration),
        },
      },
    );

    const enabled = await slot.findByRole("switch", { name: "Keep Awake" });
    expect(enabled.getAttribute("aria-checked")).toBe("false");
    expect(slot.queryByRole("button", { name: /save/u })).toBeNull();
    expect(slot.queryByText("Hosts")).toBeNull();
    expect(slot.queryByRole("radio", { name: "All hosts" })).toBeNull();
    expect(slot.queryByText("Offline")).toBeNull();
    expect(slot.queryByRole("checkbox", { name: "Laptop" })).toBeNull();

    fireEvent.click(enabled);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setConfiguration",
        input: { enabled: true, selection: { mode: "all" } },
      }),
    );
    expect(slot.getByText("Hosts")).toBeTruthy();
    expect(slot.getByText("Choose which Macs to keep awake.")).toBeTruthy();

    fireEvent.click(slot.getByRole("radio", { name: "Specific hosts" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setConfiguration",
        input: {
          enabled: true,
          selection: {
            mode: "selected",
            hostIds: ["host-1", "host-2"],
          },
        },
      }),
    );
    expect(slot.getByText("Offline")).toBeTruthy();

    fireEvent.click(slot.getByRole("checkbox", { name: "Laptop" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "setConfiguration",
        input: {
          enabled: true,
          selection: { mode: "selected", hostIds: ["host-2"] },
        },
      }),
    );
    expect(slot.getByRole("status").textContent).toBe("Saved");
  });

  it("reverts an optimistic change when autosave fails", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getConfiguration: () =>
            response({ enabled: false, selection: { mode: "all" } }),
          setConfiguration: () => {
            throw new Error("Could not save configuration");
          },
        },
      },
    );

    const enabled = await slot.findByRole("switch", { name: "Keep Awake" });
    fireEvent.click(enabled);

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("Could not save configuration");
    expect(enabled.getAttribute("aria-checked")).toBe("false");
    expect(slot.queryByRole("radio", { name: "All hosts" })).toBeNull();
  });

  it("serializes rapid autosaves so an older response cannot win", async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    let saveCount = 0;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getConfiguration: () =>
            response({ enabled: false, selection: { mode: "all" } }),
          setConfiguration: () => {
            saveCount += 1;
            return saveCount === 1 ? first.promise : second.promise;
          },
        },
      },
    );

    fireEvent.click(await slot.findByRole("switch", { name: "Keep Awake" }));
    fireEvent.click(slot.getByRole("radio", { name: "Specific hosts" }));

    await waitFor(() => expect(saveCount).toBe(1));
    await act(async () => {
      first.resolve(response({ enabled: true, selection: { mode: "all" } }));
      await first.promise;
    });
    await waitFor(() => expect(saveCount).toBe(2));
    await act(async () => {
      second.resolve(
        response({
          enabled: true,
          selection: {
            mode: "selected",
            hostIds: ["host-1", "host-2"],
          },
        }),
      );
      await second.promise;
    });

    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toBe("Saved"),
    );
    expect(
      (
        slot.getByRole("radio", {
          name: "Specific hosts",
        }) as HTMLButtonElement
      ).getAttribute("data-state"),
    ).toBe("checked");
  });
});
