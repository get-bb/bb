import { describe, expect, it } from "vitest";
import {
  pluginSdkAliasFor,
  resolvePluginSdkAliasTarget,
} from "../../../src/services/plugins/plugin-runtime.js";

describe("pluginSdkAliasFor", () => {
  it("resolves the pre-rename specifier to the same SDK runtime bundle", () => {
    const alias = pluginSdkAliasFor("/srv/plugin-sdk-runtime.js");

    expect(alias["@get-bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
    expect(alias["@bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
  });
});

describe("resolvePluginSdkAliasTarget", () => {
  it("falls back to the resolved @get-bb/plugin-sdk entry when no prebuilt runtime bundle exists (#2334)", () => {
    // This test runs the server from source (no `dist/plugin-sdk-runtime.js`
    // next to plugin-runtime.ts), the same way `pnpm dev`/`pnpm dev:desktop`
    // do. Without the fallback this returns undefined, the legacy
    // "@bb/plugin-sdk" specifier never gets aliased, and any installed
    // plugin still on that pre-rename import fails with "Cannot find
    // module '@bb/plugin-sdk'".
    const target = resolvePluginSdkAliasTarget();

    expect(target).toBeDefined();
    expect(target).toMatch(/plugin-sdk[/\\]src[/\\]index\.ts$/);
  });
});
