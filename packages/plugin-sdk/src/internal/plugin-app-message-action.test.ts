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
