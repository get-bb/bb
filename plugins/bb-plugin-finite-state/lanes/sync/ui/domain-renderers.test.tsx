// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DomainDiff,
  registerDomainDiffRenderer,
  type DomainDiffRendererProps,
} from "./domain-renderers.js";

afterEach(cleanup);

describe("domain diff renderer registry", () => {
  it("passes only the stable id and display mode to registered lane renderers", () => {
    const renderer = vi.fn(({ id, mode }: DomainDiffRendererProps) => (
      <p>{mode}:{id}</p>
    ));
    registerDomainDiffRenderer("threat", renderer);
    registerDomainDiffRenderer("requirement", renderer);
    registerDomainDiffRenderer("vexDecision", renderer);

    const view = render(
      <>
        <DomainDiff id="THREAT-22" kind="threat" />
        <DomainDiff id="REQ-9" kind="requirement" />
        <DomainDiff id="VEX-4" kind="vexDecision" />
      </>,
    );

    expect(view.getByText("diff:THREAT-22")).toBeTruthy();
    expect(view.getByText("diff:REQ-9")).toBeTruthy();
    expect(view.getByText("diff:VEX-4")).toBeTruthy();
    expect(renderer).toHaveBeenCalledWith(
      { id: "THREAT-22", mode: "diff" },
      undefined,
    );
  });

  it("uses a typed identity fallback and rejects duplicate registration", () => {
    const fallback = render(<DomainDiff id="MIT-9" kind="mitigation" />);
    expect(fallback.getByText("mitigation domain preview")).toBeTruthy();
    expect(fallback.queryByText(/yaml/iu)).toBeNull();
    fallback.unmount();

    expect(() =>
      registerDomainDiffRenderer("threat", () => <p>duplicate</p>),
    ).toThrow("already registered for threat");
  });
});
