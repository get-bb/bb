import { describe, expect, it } from "vitest";
import { PLUGIN_SDK_APP_EXPORT_NAMES } from "@bb/plugin-sdk";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

describe("plugin sdk app implementation", () => {
  it("has exactly the facade's runtime export names (shim sync)", () => {
    // `bb plugin build` generates the @bb/plugin-sdk/app shim's named-export
    // list from PLUGIN_SDK_APP_EXPORT_NAMES; every name must exist on the
    // runtime object (and nothing extra may hide behind an unexported key).
    // Hooks-only since the kit removal (plugin design §5.5).
    expect(Object.keys(pluginSdkAppImplementation).sort()).toEqual(
      [...PLUGIN_SDK_APP_EXPORT_NAMES].sort(),
    );
  });
});
