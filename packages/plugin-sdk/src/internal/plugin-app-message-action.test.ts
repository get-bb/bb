import { describe, expect, it } from "vitest";
import type { PluginMessageActionRegistration } from "../app-contract.js";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

function collect(registration: PluginMessageActionRegistration) {
  return collectPluginAppRegistrations({
    __bbPluginApp: true,
    setup(app) {
      app.slots.messageAction(registration);
    },
  }).messageActions;
}

const run = () => {};

describe("messageAction surfaces", () => {
  it("shows an action on every surface unless it names some", () => {
    expect(
      collect({ id: "everywhere", title: "Everywhere", run })[0]
        ?.experimental_surfaces,
    ).toEqual(["thread-view", "embedded-chat"]);
    expect(
      collect({
        id: "thread-only",
        title: "Thread only",
        experimental_surfaces: ["thread-view"],
        run,
      })[0]?.experimental_surfaces,
    ).toEqual(["thread-view"]);
  });

  it("rejects an empty or unknown surface list", () => {
    const register = (experimental_surfaces: unknown) => () =>
      collect({
        id: "action",
        title: "Action",
        experimental_surfaces:
          experimental_surfaces as PluginMessageActionRegistration["experimental_surfaces"],
        run,
      });
    expect(register([])).toThrow(/experimental_surfaces/);
    expect(register(["sidebar"])).toThrow(/experimental_surfaces/);
    expect(register("thread-view")).toThrow(/experimental_surfaces/);
  });
});

describe("messageAction roles, placements, order and availability", () => {
  it("fills the defaults that keep an action where it showed before", () => {
    const plain = collect({ id: "plain", title: "Plain", run })[0];
    expect(plain).toMatchObject({
      experimental_roles: ["user", "assistant"],
      experimental_placements: ["inline", "selection"],
    });
    expect(plain).not.toHaveProperty("experimental_order");
  });

  it("keeps the named roles and placements in canonical order", () => {
    expect(
      collect({
        id: "narrow",
        title: "Narrow",
        experimental_roles: ["assistant"],
        experimental_placements: ["selection", "menu"],
        experimental_order: -5,
        experimental_availability: () => "hidden",
        run,
      })[0],
    ).toMatchObject({
      experimental_roles: ["assistant"],
      experimental_placements: ["menu", "selection"],
      experimental_order: -5,
    });
  });

  it("rejects invalid roles, placements, order and availability", () => {
    const register =
      (
        fields: Partial<Record<keyof PluginMessageActionRegistration, unknown>>,
      ) =>
      () =>
        collect({
          id: "action",
          title: "Action",
          run,
          ...(fields as Partial<PluginMessageActionRegistration>),
        });
    expect(register({ experimental_roles: [] })).toThrow(/experimental_roles/);
    expect(register({ experimental_roles: ["system"] })).toThrow(
      /experimental_roles/,
    );
    expect(register({ experimental_placements: [] })).toThrow(
      /experimental_placements/,
    );
    expect(register({ experimental_placements: ["inline", "menu"] })).toThrow(
      /cannot hold both "inline" and "menu"/,
    );
    expect(register({ experimental_placements: ["header"] })).toThrow(
      /experimental_placements/,
    );
    expect(register({ experimental_order: Number.NaN })).toThrow(
      /experimental_order/,
    );
    expect(register({ experimental_availability: "hidden" })).toThrow(
      /experimental_availability/,
    );
  });
});
