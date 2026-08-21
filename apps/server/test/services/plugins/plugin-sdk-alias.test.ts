import { describe, expect, it } from "vitest";
import { pluginSdkAliasFor } from "../../../src/services/plugins/plugin-runtime.js";

describe("pluginSdkAliasFor", () => {
  it("resolves the pre-rename specifier to the same SDK runtime bundle", () => {
    // Plugin server artifacts built before the @bb → @get-bb rename still
    // carry a bare "@bb/plugin-sdk" import; without the legacy alias the
    // loader fails to resolve it and every such install stops loading.
    const alias = pluginSdkAliasFor("/srv/plugin-sdk-runtime.js");

    expect(alias["@get-bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
    expect(alias["@bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
  });
});
