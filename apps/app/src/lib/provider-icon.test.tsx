// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getProviderIconInfo } from "./provider-icon";

describe("getProviderIconInfo", () => {
  it("prefers a configured provider logo over the generic ACP icon", () => {
    const iconInfo = getProviderIconInfo(
      "acp-do-computer",
      "/api/v1/system/providers/acp-do-computer/logo",
    );
    if (iconInfo === undefined) {
      throw new Error("Expected configured provider logo icon info");
    }
    expect(
      getProviderIconInfo(
        "acp-do-computer",
        "/api/v1/system/providers/acp-do-computer/logo",
      )?.icon,
    ).toBe(iconInfo.icon);

    const view = render(
      createElement(iconInfo.icon, { className: "size-4 shrink-0" }),
    );
    const logo = view.container.querySelector("img");
    expect(logo).not.toBeNull();
    if (logo === null) {
      throw new Error("Expected provider logo image");
    }
    expect(logo.getAttribute("src")).toBe(
      "/api/v1/system/providers/acp-do-computer/logo",
    );
    expect([...logo.classList]).toEqual([
      "size-4",
      "shrink-0",
      "object-contain",
    ]);

    fireEvent.error(logo);
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("svg")).not.toBeNull();
  });
});
