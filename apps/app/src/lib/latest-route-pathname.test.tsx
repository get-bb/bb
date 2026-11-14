// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { useLatestRoutePathname } from "./latest-route-pathname";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("reads a BrowserRouter navigation before the router commits it", () => {
  const seen: {
    navigate?: ReturnType<typeof useNavigate>;
    readLatest?: () => string | null;
    committed?: string;
  } = {};
  function Probe() {
    seen.navigate = useNavigate();
    seen.readLatest = useLatestRoutePathname();
    seen.committed = useLocation().pathname;
    return null;
  }
  window.history.replaceState(null, "", "/threads/thr-a");
  render(
    <BrowserRouter>
      <Probe />
    </BrowserRouter>,
  );
  expect(seen.readLatest?.()).toBe("/threads/thr-a");

  void seen.navigate?.("/threads/thr-b");

  expect(seen.readLatest?.()).toBe("/threads/thr-b");
  expect(seen.committed).toBe("/threads/thr-a");
});
