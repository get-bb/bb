// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalServers } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);

async function loadSwitcher() {
  const app = await loadPluginApp(() => import("./app"), { hasServers: true });
  const item = app.experimentalSidebarFooterItems[0];
  if (item?.kind !== "disclosure") throw new Error("missing disclosure");
  return item;
}

function servers(overrides: Partial<ExperimentalServers> = {}) {
  return {
    status: "ready",
    servers: [
      {
        id: "builtin",
        name: "This Mac",
        origin: "http://127.0.0.1:38886",
        kind: "local",
        active: true,
      },
      {
        id: "connect:studio",
        name: "Studio",
        origin: "https://studio.getbb.app",
        kind: "account",
        active: false,
      },
    ],
    switchTo: vi.fn(),
    addServer: vi.fn(),
    accountSignIn: { label: "Sign in to bb Connect…", start: vi.fn() },
    ...overrides,
  } satisfies ExperimentalServers;
}

describe("server switcher", () => {
  it("registers no footer item in a web browser", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.experimentalSidebarFooterItems).toEqual([]);
  });

  it("focuses the current server and leaves it without switching", async () => {
    const choices = servers();
    const dismiss = vi.fn();
    const slot = renderSlot(
      await loadSwitcher(),
      { dismiss },
      { servers: choices },
    );
    const current = slot.getByRole("button", { name: /This Mac/ });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(current);
    fireEvent.click(current);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(choices.switchTo).not.toHaveBeenCalled();
  });

  it("closes before switching to another server", async () => {
    const order: string[] = [];
    const choices = servers({ switchTo: (id) => order.push(`switch ${id}`) });
    const slot = renderSlot(
      await loadSwitcher(),
      { dismiss: () => order.push("dismiss") },
      { servers: choices },
    );
    fireEvent.click(slot.getByRole("button", { name: /Studio/ }));
    expect(order).toEqual(["dismiss", "switch connect:studio"]);
  });

  it("opens add-server and bb Connect sign-in, closing the panel each time", async () => {
    const signIn = { label: "Sign in to bb Connect…", start: vi.fn() };
    const choices = servers({ accountSignIn: signIn });
    const dismiss = vi.fn();
    const slot = renderSlot(
      await loadSwitcher(),
      { dismiss },
      { servers: choices },
    );
    fireEvent.click(slot.getByRole("button", { name: "Add server…" }));
    fireEvent.click(
      slot.getByRole("button", { name: "Sign in to bb Connect…" }),
    );
    expect(choices.addServer).toHaveBeenCalledTimes(1);
    expect(signIn.start).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it("offers only the servers when the client has no add or sign-in screen", async () => {
    const slot = renderSlot(
      await loadSwitcher(),
      { dismiss: vi.fn() },
      { servers: servers({ addServer: null, accountSignIn: null }) },
    );
    expect(
      slot.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["This Mac127.0.0.1:38886", "Studiostudio.getbb.app"]);
  });
});
