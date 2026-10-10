import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  resolveTerminalHost,
  TerminalHostSelector,
} from "./TerminalHostSelector";

const studio = makeHost({
  id: "host-studio",
  name: "Studio",
});
const laptop = makeHost({
  ...studio,
  id: "host-laptop",
  name: "Laptop",
});

function renderSelector(hosts: readonly Host[]) {
  return renderToStaticMarkup(
    createElement(TerminalHostSelector, {
      disabled: false,
      hosts,
      isLoading: false,
      onChange: () => {},
      selectedHostId: studio.id,
    }),
  );
}

describe("TerminalHostSelector", () => {
  it("shows a single machine as a quiet value instead of a picker", () => {
    const markup = renderSelector([studio]);

    expect(markup).toContain("Studio");
    expect(markup).not.toContain("<button");
    expect(renderSelector([studio, laptop])).toContain("<button");
  });
});

describe("resolveTerminalHost", () => {
  it("falls back from an unavailable preference to a connected machine", () => {
    const offlineLaptop = { ...laptop, status: "disconnected" as const };

    expect(
      resolveTerminalHost({
        hosts: [offlineLaptop, studio],
        preferredHostId: offlineLaptop.id,
        primaryHostId: offlineLaptop.id,
      }),
    ).toBe(studio);
  });
});
