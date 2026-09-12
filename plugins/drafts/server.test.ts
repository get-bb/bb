import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

function setup() {
  const fake = createFakePluginHost({ pluginId: "drafts" });
  plugin(fake.bb);
  const hook = fake.harness.registrations.hooks["message.dispatch"];
  if (hook === null) throw new Error("message.dispatch was not registered");
  return hook;
}

describe("draft dispatch gate", () => {
  it("waits for a submission tagged as a draft by this plugin", () => {
    const hook = setup();
    expect(
      hook(
        makeMessageDispatchHookContext({
          experimental_submission: {
            pluginId: "drafts",
            data: { kind: "draft" },
          },
        }),
      ),
    ).toEqual({ action: "wait", reason: "Draft" });
  });

  it("does not claim submissions from other plugins", () => {
    const hook = setup();
    expect(
      hook(
        makeMessageDispatchHookContext({
          experimental_submission: {
            pluginId: "other-plugin",
            data: { kind: "draft" },
          },
        }),
      ),
    ).toEqual({ action: "proceed" });
  });
});
