// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  hasSingleUseRootComposeTargetState,
  shouldStartComposingFromLocationState,
} from "@/views/RootComposeView";
import { readThreadCreationPlacement } from "@/lib/thread-creation-placement";
import { useCreateThreadInEnvironment } from "./useCreateThreadInEnvironment";

const navigate = vi.fn();

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => navigate,
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => vi.fn(),
}));

describe("useCreateThreadInEnvironment", () => {
  it.each(["sec_a", null])(
    "opens the composer in the source environment and section %s",
    (sectionId) => {
      navigate.mockClear();
      const { result } = renderHook(() =>
        useCreateThreadInEnvironment({
          projectId: "proj_personal",
          environmentId: "env_1",
          sectionId,
          pinned: true,
        }),
      );

      result.current();

      const state = navigate.mock.calls[0][1].state;
      expect(state.reuseEnvironmentId).toBe("env_1");
      expect(readThreadCreationPlacement(state)).toEqual({
        sectionId,
        pinned: true,
      });
      expect(shouldStartComposingFromLocationState(state)).toBe(true);
      expect(hasSingleUseRootComposeTargetState(state)).toBe(true);
    },
  );
});
