// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import * as corePluginSdkApp from "./core-plugin-sdk-app";
import * as lazyCorePluginSdkApp from "./core-plugin-sdk-app-lazy";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import * as sharedUiPluginSdkApp from "./shared-ui-plugin-sdk-app";

describe("core plugin SDK bindings", () => {
  it.each([
    ["core contributions", corePluginSdkApp],
    ["lazy core contributions", lazyCorePluginSdkApp],
    ["shared-ui components", sharedUiPluginSdkApp],
  ])(
    "binds %s to the same members plugins reach through the runtime",
    (_, binding) => {
      const runtimeMembers = new Map<string, unknown>(
        Object.entries(pluginSdkAppImplementation),
      );
      for (const [name, member] of Object.entries(binding)) {
        expect(runtimeMembers.get(name), name).toBe(member);
      }
    },
  );
});
