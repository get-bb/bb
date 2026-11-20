// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import * as corePluginSdkApp from "./core-plugin-sdk-app";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

describe("core plugin SDK binding", () => {
  it("binds core to the same members plugins reach through the runtime", () => {
    const runtimeMembers = new Map<string, unknown>(
      Object.entries(pluginSdkAppImplementation),
    );
    for (const [name, member] of Object.entries(corePluginSdkApp)) {
      expect(runtimeMembers.get(name), name).toBe(member);
    }
  });
});
