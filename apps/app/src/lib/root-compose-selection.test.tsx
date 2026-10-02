// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ForkThreadCreateSeed } from "@bb/client-core";
import {
  useRootComposeForkSeed,
  useRootComposePlacement,
  useRootComposeReuseEnvironment,
} from "./root-compose-selection";

describe("root compose targets across layout remounts", () => {
  it("persists placement into a fresh store without persisting the fork seed, then clears it", () => {
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const useTargets = () => ({
      placement: useRootComposePlacement(),
      environment: useRootComposeReuseEnvironment(),
      fork: useRootComposeForkSeed(),
    });
    const fork: ForkThreadCreateSeed = {
      environmentId: "env_test",
      model: "test-model",
      permissionMode: "accept-edits",
      projectId: "proj_test",
      providerId: "test-provider",
      reasoningLevel: "medium",
      serviceTier: undefined,
      sourceSeqEnd: undefined,
      sourceThreadId: "thr_source",
      sourceThreadTitle: "Source thread",
    };
    const first = renderHook(useTargets, { wrapper });
    act(() => {
      first.result.current.placement[1]({
        sectionId: "sec_research",
        pinned: true,
      });
      first.result.current.environment[1]("reuse:env_test");
      first.result.current.fork[1](fork);
    });
    first.unmount();
    const reloadedWrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={createStore()}>{children}</Provider>
    );
    const remounted = renderHook(useTargets, { wrapper: reloadedWrapper });
    expect(remounted.result.current.placement[0]).toEqual({
      sectionId: "sec_research",
      pinned: true,
    });
    expect(remounted.result.current.environment[0]).toBe("reuse:env_test");
    expect(remounted.result.current.fork[0]).toBeNull();
    act(() => {
      remounted.result.current.placement[1]({ sectionId: null, pinned: false });
      remounted.result.current.environment[1](null);
      remounted.result.current.fork[1](null);
    });
    remounted.unmount();
    const fresh = renderHook(useTargets, { wrapper: reloadedWrapper });
    expect(fresh.result.current.placement[0]).toEqual({
      sectionId: null,
      pinned: false,
    });
    expect(fresh.result.current.fork[0]).toBeNull();
  });
});
