// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_SDK_APP_EXPORT_NAMES } from "@bb/plugin-sdk";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

afterEach(cleanup);

describe("plugin sdk app implementation", () => {
  it("has exactly the facade's runtime export names (shim sync)", () => {
    // `bb plugin build` generates the @bb/plugin-sdk/app shim's named-export
    // list from PLUGIN_SDK_APP_EXPORT_NAMES; every name must exist on the
    // runtime object (and nothing extra may hide behind an unexported key).
    expect(Object.keys(pluginSdkAppImplementation).sort()).toEqual(
      [...PLUGIN_SDK_APP_EXPORT_NAMES].sort(),
    );
  });

  it("PageBody renders the classic centered width-capped column", () => {
    const { PageBody } = pluginSdkAppImplementation;
    const { container } = render(
      <PageBody className="custom-extra">
        <p>body</p>
      </PageBody>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("mx-auto");
    expect(wrapper?.className).toContain("w-full");
    expect(wrapper?.className).toContain("max-w-3xl");
    expect(wrapper?.className).toContain("custom-extra");
    expect(wrapper?.textContent).toBe("body");
  });
});
