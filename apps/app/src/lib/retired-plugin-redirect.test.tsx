// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useRedirectRetiredPluginPaths } from "./retired-plugin-redirect";

function Probe({ seen }: { seen: string[] }) {
  useRedirectRetiredPluginPaths();
  const location = useLocation();
  seen.push(`${location.pathname}${location.search}`);
  return null;
}

describe("useRedirectRetiredPluginPaths", () => {
  it("replaces a retired plugin id in the current path with its successor", () => {
    const seen: string[] = [];
    render(
      <MemoryRouter
        initialEntries={[
          "/settings/plugins/bb--provider-acp-next?tab=settings",
        ]}
      >
        <Probe seen={seen} />
      </MemoryRouter>,
    );
    expect(seen.at(-1)).toBe("/settings/plugins/provider-acp?tab=settings");
  });

  it("leaves other paths alone", () => {
    const seen: string[] = [];
    render(
      <MemoryRouter initialEntries={["/settings/plugins/provider-acp"]}>
        <Probe seen={seen} />
      </MemoryRouter>,
    );
    expect(new Set(seen)).toEqual(new Set(["/settings/plugins/provider-acp"]));
  });
});
