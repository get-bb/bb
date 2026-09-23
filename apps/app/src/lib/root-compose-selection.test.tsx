// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ForkThreadCreateSeed } from "@bb/client-core";
import {
  useRootComposeForkSeed,
  useRootComposeSectionId,
} from "./root-compose-selection";

describe("root compose targets across layout remounts", () => {
  it("retains section and fork targets when the composer remounts, then clears them", () => {
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const useTargets = () => ({
      section: useRootComposeSectionId(),
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
      first.result.current.section[1]("sec_research");
      first.result.current.fork[1](fork);
    });
    first.unmount();
    const remounted = renderHook(useTargets, { wrapper });
    expect(remounted.result.current.section[0]).toBe("sec_research");
    expect(remounted.result.current.fork[0]).toEqual(fork);
    act(() => {
      remounted.result.current.section[1](null);
      remounted.result.current.fork[1](null);
    });
    remounted.unmount();
    const fresh = renderHook(useTargets, { wrapper });
    expect(fresh.result.current.section[0]).toBeNull();
    expect(fresh.result.current.fork[0]).toBeNull();
  });
});
