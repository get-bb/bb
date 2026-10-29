// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentDiagnostic,
  aggregateAgentReadiness,
  createVisibleTransitionObserver,
  onboardingNavigation,
  useVisibleObservation,
} from "./onboarding-journey-observation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("visible journey observations", () => {
  it("deduplicates polling while retaining real state transitions", () => {
    const observe = createVisibleTransitionObserver();
    expect(observe("install", false)).toBeNull();
    expect(observe("install", true)).toBe("step_visible");
    expect(observe("install", true)).toBeNull();
    expect(observe("ready", false)).toBeNull();
    expect(observe("ready", true)).toBe("state_changed");
    expect(observe("install", true)).toBe("state_changed");
  });

  it("waits for viewport and active document, deduplicates rerenders, and counts reopening", () => {
    const callbacks: ((visible: boolean) => void)[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (
            entries: { isIntersecting: boolean; intersectionRatio: number }[],
          ) => void,
        ) {
          callbacks.push((visible) =>
            callback([
              { isIntersecting: visible, intersectionRatio: visible ? 1 : 0 },
            ]),
          );
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    let visible = false;
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
      visible ? "visible" : "hidden",
    );
    const record = vi.fn();
    function Card({ state }: { state: string }) {
      const transition = useRef(createVisibleTransitionObserver());
      const ref = useVisibleObservation<HTMLDivElement>(() => {
        const trigger = transition.current(state, true);
        if (trigger !== null) record(state, trigger);
      });
      return <div ref={ref} />;
    }
    const view = render(<Card state="install" />);
    act(() => callbacks[0]?.(true));
    expect(record).not.toHaveBeenCalled();
    visible = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(record).toHaveBeenCalledExactlyOnceWith("install", "step_visible");
    view.rerender(<Card state="install" />);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(record).toHaveBeenCalledTimes(1);
    act(() => callbacks[0]?.(false));
    view.rerender(<Card state="ready" />);
    expect(record).toHaveBeenCalledTimes(1);
    act(() => callbacks[0]?.(true));
    expect(record).toHaveBeenLastCalledWith("ready", "state_changed");
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    render(<Card state="ready" />);
    act(() => callbacks[1]?.(true));
    expect(record).toHaveBeenLastCalledWith("ready", "step_visible");
    expect(record).toHaveBeenCalledTimes(3);
  });
});

describe("bounded diagnostics and navigation", () => {
  it("keeps unknown readiness and strips private provider detail", () => {
    expect(aggregateAgentReadiness(undefined, false)).toBeNull();
    expect(aggregateAgentReadiness([{ status: "unknown" }], false)).toBeNull();
    expect(aggregateAgentReadiness([{ status: "ready" }], true)).toBeNull();
    expect(
      aggregateAgentReadiness(
        [{ status: "ready" }, { status: "unknown" }],
        false,
      ),
    ).toBe(true);
    expect(aggregateAgentReadiness([{ status: "not_installed" }], false)).toBe(
      false,
    );
    expect(
      agentDiagnostic({ status: "ready", detail: "private@example.com" }),
    ).toEqual({ state: "ready", action_available: null });
    expect(
      agentDiagnostic({
        status: "installFailed",
        message: "private path",
        canInstall: false,
      }),
    ).toEqual({ state: "install_failed", action_available: false });
    expect(
      agentDiagnostic({ status: "signIn", reason: "expired", canSignIn: true }),
    ).toEqual({ state: "sign_in", action_available: true });
  });

  it("distinguishes skips, continue, back, explicit step choice and observed route departure", () => {
    expect(
      onboardingNavigation("first_run", "agent", "skip_step", "projects", true),
    ).toMatchObject({ action: "skip_step", reason: "agent_not_ready" });
    expect(
      onboardingNavigation("replay", "projects", "skip_step", "plugins"),
    ).toMatchObject({ action: "skip_step", reason: "explicit_skip" });
    expect(
      onboardingNavigation("replay", "plugins", "skip_setup", null),
    ).toMatchObject({
      action: "skip_setup",
      destination_step: null,
      reason: "explicit_skip",
    });
    for (const action of ["continue", "back", "select_step"] as const) {
      expect(
        onboardingNavigation("replay", "projects", action, "agent"),
      ).toMatchObject({ action, reason: "none", destination_step: "agent" });
    }
    expect(
      onboardingNavigation("first_run", "devices", "leave", null),
    ).toMatchObject({ action: "leave", reason: "navigation_away" });
  });
});
